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
import mqtt, { MqttClient } from 'mqtt';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
];
const vTopic = (code: string, part: string) => `ct1/${code}/${part}`;

function brokerList(): string[] {
  try {
    const b = new URLSearchParams(location.search).get('broker');
    if (b) return [b];
  } catch { /* non-browser */ }
  return BROKERS;
}

function connectVoiceBus(clientId: string, willTopic: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const clients: MqttClient[] = [];
    const kill = (c: MqttClient) => { try { c.end(true); } catch { /* noop */ } };
    const overall = setTimeout(() => {
      if (settled) return;
      settled = true;
      clients.forEach(kill);
      reject(new Error('voice bus unreachable'));
    }, 15000);
    brokerList().forEach((url) => {
      let c: MqttClient;
      try {
        c = mqtt.connect(url, {
          connectTimeout: 12000, reconnectPeriod: 2000, clientId,
          will: { topic: willTopic, payload: '', retain: true, qos: 1 } as any,
        });
      } catch { return; }
      clients.push(c);
      c.on('connect', () => {
        if (settled) { kill(c); return; }
        settled = true;
        clearTimeout(overall);
        clients.forEach(o => { if (o !== c) kill(o); });
        resolve(c);
      });
      c.on('error', () => { /* race decides */ });
    });
    if (!clients.length) { settled = true; clearTimeout(overall); reject(new Error('voice bus unreachable')); }
  });
}

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
  const client = await connectVoiceBus('ct-v-' + myId + '-' + Math.random().toString(36).slice(2, 7), presenceTopic)
    .catch((e) => { stream.getTracks().forEach(t => t.stop()); throw e; });

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
        client.publish(vTopic(code, 'vs/' + pid), JSON.stringify({ from: myId, kind: 'ice', candidate: ev.candidate.toJSON() }), { qos: 0 });
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
      client.publish(vTopic(code, 'vs/' + pid), JSON.stringify({ from: myId, kind: 'offer', sdp: offer.sdp }), { qos: 1 });
    } catch { /* pair will retry on next presence refresh */ }
  };

  client.subscribe(vTopic(code, 'v/+'), { qos: 1 });
  client.subscribe(vTopic(code, 'vs/' + myId), { qos: 1 });
  client.on('message', async (topicName, payload) => {
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
        client.publish(vTopic(code, 'vs/' + from), JSON.stringify({ from: myId, kind: 'answer', sdp: answer.sdp }), { qos: 1 });
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
  client.on('connect', () => {
    // (Re)announce presence after any reconnect.
    client.publish(presenceTopic, JSON.stringify({ id: myId, ts: Date.now() }), { retain: true, qos: 1 });
  });
  client.publish(presenceTopic, JSON.stringify({ id: myId, ts: Date.now() }), { retain: true, qos: 1 });
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
      try { client.publish(presenceTopic, '', { retain: true, qos: 1 }); } catch { /* noop */ }
      [...peers.keys()].forEach(closePeer);
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close().catch(() => { /* noop */ });
      setTimeout(() => { try { client.end(true); } catch { /* noop */ } }, 300);
    },
  };
}
