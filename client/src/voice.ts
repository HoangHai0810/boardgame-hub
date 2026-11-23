// Voice chat (v26): a WebRTC audio MESH between the players of one room.
//
// Why this shape:
// - Signaling rides the game's own MQTT bus (topics under the room code),
//   the one transport proven to work on the players' real networks — no
//   new service, no PeerJS cloud. Voice has its own MQTT connection so it
//   works identically on every game transport (MQTT / PeerJS / Socket.IO).
// - Presence is a RETAINED message per player (+ a will that clears it),
//   so late joiners discover the whole mesh from the broker alone.
// - Deterministic initiator (smaller clientId offers) avoids offer glare
//   without a perfect-negotiation state machine.
// - STUN only (Google) — there is no free TURN we can ship; on the rare
//   symmetric-NAT pair the two players simply won't hear EACH OTHER while
//   the rest of the mesh keeps working. Failure is per-pair and silent,
//   never fatal to the room.
// - The mic is acquired BEFORE presence is published, so every peer
//   connection is born with the local track attached (no renegotiation).
//   Muting is track.enabled — instant and renegotiation-free.
import type { MqttClient } from 'mqtt';
import { brokerOrder, connectMqttSequential } from './brokers';

const vTopic = (code: string, part: string) => `ct1/${code}/${part}`;

export interface VoiceHandle {
  setMuted(muted: boolean): void;
  leave(): void;
}

export interface VoiceCallbacks {
  /** Full set of player ids currently producing sound (incl. self). */
  onSpeaking(ids: Set<string>): void;
  /** Player ids present in the voice mesh (incl. self). */
  onPeers(ids: Set<string>): void;
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  iceBacklog: RTCIceCandidateInit[];
  remoteSet: boolean;
}

export async function joinVoice(roomCode: string, myId: string, cb: VoiceCallbacks): Promise<VoiceHandle> {
  // Mic FIRST: if the user denies permission we never join the mesh.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const code = roomCode.toUpperCase();
  const presenceTopic = vTopic(code, 'v/' + myId);
  // Same deterministic per-room broker order as the game bus (brokers.ts):
  // the whole voice mesh gathers on ONE broker, and a failover advances
  // to the next broker in the same order for everyone.
  const order = brokerOrder(code);
  let busIdx = 0;
  let bus: MqttClient | null = null;
  const voiceClientId = 'ct-v-' + myId + '-' + Math.random().toString(36).slice(2, 7);
  const busExtra = () => ({
    clientId: voiceClientId,
    will: { topic: presenceTopic, payload: '', retain: true, qos: 1 } as any,
  });
  const publish = (tpc: string, payload: string, opts?: object) => {
    try { bus?.publish(tpc, payload, opts as any); } catch { /* bus swapping */ }
  };

  const peers = new Map<string, Peer>();
  const peerIds = new Set<string>([myId]);
  let left = false;

  const audioCtx = new AudioContext();
  audioCtx.resume().catch(() => { /* starts on the mic-click gesture anyway */ });
  const analysers = new Map<string, AnalyserNode>();
  const makeAnalyser = (s: MediaStream): AnalyserNode => {
    const src = audioCtx.createMediaStreamSource(s);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    return an;
  };
  analysers.set(myId, makeAnalyser(stream));

  const publishPeers = () => cb.onPeers(new Set(peerIds));

  const closePeer = (pid: string) => {
    const p = peers.get(pid);
    if (!p) return;
    try { p.pc.close(); } catch { /* noop */ }
    try { p.audio.srcObject = null; p.audio.remove(); } catch { /* noop */ }
    peers.delete(pid);
    analysers.delete(pid);
    peerIds.delete(pid);
    publishPeers();
  };

  const ensurePeer = (pid: string): Peer => {
    const existing = peers.get(pid);
    if (existing) return existing;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    const audio = document.createElement('audio');
    audio.autoplay = true;
    (audio as any).playsInline = true;
    document.body.appendChild(audio);
    const peer: Peer = { pc, audio, analyser: null, iceBacklog: [], remoteSet: false };
    peers.set(pid, peer);
    peerIds.add(pid);
    publishPeers();

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        publish(vTopic(code, 'vs/' + pid), JSON.stringify({ from: myId, kind: 'ice', candidate: ev.candidate.toJSON() }), { qos: 0 });
      }
    };
    pc.ontrack = (ev) => {
      const remote = ev.streams[0];
      if (remote) {
        audio.srcObject = remote;
        audio.play().catch(() => { /* user gesture already happened (mic click) */ });
        peer.analyser = makeAnalyser(remote);
        analysers.set(pid, peer.analyser);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(pid);
    };
    return peer;
  };

  const makeOffer = async (pid: string) => {
    const peer = ensurePeer(pid);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      publish(vTopic(code, 'vs/' + pid), JSON.stringify({ from: myId, kind: 'offer', sdp: offer.sdp }), { qos: 1 });
    } catch { /* pair will retry on next presence refresh */ }
  };

  let failoverTimer: ReturnType<typeof setTimeout> | null = null;
  let failoverBusy = false;
  const publishPresence = () => publish(presenceTopic, JSON.stringify({ id: myId, ts: Date.now() }), { retain: true, qos: 1 });

  function attach(c: MqttClient) {
    c.subscribe(vTopic(code, 'v/+'), { qos: 1 });
    c.subscribe(vTopic(code, 'vs/' + myId), { qos: 1 });
  c.on('message', async (topicName, payload) => {
    if (left) return;
    const text = payload.toString();
    if (topicName.startsWith(vTopic(code, 'v/'))) {
      const pid = topicName.slice(vTopic(code, 'v/').length);
      if (pid === myId) return;
      if (!text) { closePeer(pid); return; } // retained cleared / will fired
      // A voice peer is present. Connect if we haven't; the smaller id offers.
      if (!peers.has(pid)) {
        ensurePeer(pid);
        if (myId < pid) void makeOffer(pid);
      }
      return;
    }
    // signaling for me
    let msg: any; try { msg = JSON.parse(text); } catch { return; }
    const from = String(msg.from || '');
    if (!from || from === myId) return;
    const peer = ensurePeer(from);
    try {
      if (msg.kind === 'offer') {
        // Glare rule: the designated initiator (smaller id) ignores
        // incoming offers — its own offer wins by construction.
        if (myId < from) return;
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        peer.remoteSet = true;
        peer.iceBacklog.splice(0).forEach(c => peer.pc.addIceCandidate(c).catch(() => {}));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        publish(vTopic(code, 'vs/' + from), JSON.stringify({ from: myId, kind: 'answer', sdp: answer.sdp }), { qos: 1 });
      } else if (msg.kind === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        peer.remoteSet = true;
        peer.iceBacklog.splice(0).forEach(c => peer.pc.addIceCandidate(c).catch(() => {}));
      } else if (msg.kind === 'ice' && msg.candidate) {
        if (peer.remoteSet) await peer.pc.addIceCandidate(msg.candidate);
        else peer.iceBacklog.push(msg.candidate);
      }
    } catch { /* a failed pair degrades silently; the mesh lives on */ }
  });
    // (Re)announce presence after any reconnect.
    c.on('connect', publishPresence);
    c.on('offline', () => {
      if (failoverTimer || left) return;
      failoverTimer = setTimeout(() => { failoverTimer = null; void failoverBus(); }, 9000);
    });
  }

  async function failoverBus() {
    if (failoverBusy || left) return;
    failoverBusy = true;
    try {
      const old = bus;
      try { old?.end(true); } catch { /* noop */ }
      const r = await connectMqttSequential(order, (busIdx + 1) % order.length, busExtra());
      bus = r.client; busIdx = r.idx;
      attach(bus);
      if (bus.connected) publishPresence();
      // Rebuild pairs whose connections died with the old bus: presence
      // re-delivery recreates missing peers; live PCs keep their tracks.
      [...peerIds].forEach(pid => { if (pid !== myId && !peers.has(pid)) { ensurePeer(pid); if (myId < pid) void makeOffer(pid); } });
    } catch {
      if (!failoverTimer && !left) failoverTimer = setTimeout(() => { failoverTimer = null; void failoverBus(); }, 9000);
    } finally { failoverBusy = false; }
  }

  try {
    const r0 = await connectMqttSequential(order, 0, busExtra());
    bus = r0.client; busIdx = r0.idx;
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    throw e;
  }
  attach(bus);
  if (bus.connected) publishPresence();
  publishPeers();

  // Speaking detection: poll every analyser; report only on CHANGE.
  let lastSpeaking = '';
  const poll = setInterval(() => {
    if (left) return;
    const speaking = new Set<string>();
    const buf = new Uint8Array(256);
    analysers.forEach((an, pid) => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      if (Math.sqrt(sum / buf.length) > 0.03) speaking.add(pid);
    });
    const key = [...speaking].sort().join(',');
    if (key !== lastSpeaking) { lastSpeaking = key; cb.onSpeaking(speaking); }
  }, 200);

  return {
    setMuted(muted: boolean) {
      stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    },
    leave() {
      left = true;
      clearInterval(poll);
      try { publish(presenceTopic, '', { retain: true, qos: 1 }); } catch { /* noop */ }
      [...peers.keys()].forEach(closePeer);
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close().catch(() => { /* noop */ });
      if (failoverTimer) { clearTimeout(failoverTimer); failoverTimer = null; }
      const b = bus; bus = null;
      setTimeout(() => { try { b?.end(true); } catch { /* noop */ } }, 300);
    },
  };
}
