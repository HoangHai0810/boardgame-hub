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
// - STUN (Google) + Metered Open Relay TURN via the static-auth scheme:
//   the widely copy-pasted `openrelayproject` / `openrelayproject` pair
//   on openrelay.metered.ca is STALE (Metered now requires signup + API
//   key for it — and the PO's live report of 2026-11-25, mic on but
//   silence both ways, is exactly the symptom of a dead relay: a phone
//   on carrier NAT and a computer on a home/office network usually
//   CANNOT reach each other peer-to-peer). The documented no-signup
//   mechanism is staticauth.openrelay.metered.ca with a time-limited
//   TURN-REST credential — username "<expiry>:<label>", credential =
//   base64(HMAC-SHA1('openrelayprojectsecret', username)) — computed
//   here with WebCrypto at join time (24h validity, far longer than a
//   voice session). The old pair is kept last as a fallback; failure
//   stays per-pair and silent, never fatal to the room.
// - Speaker and mic are SEPARATE (v29, Hoàng's ask): joining voice is
//   listen-only — you hear everyone without a mic (peer connections are
//   born with a recvonly audio transceiver). Enabling the mic later
//   REBUILDS each pair (kind:'reset'): a recvonly transceiver cannot be
//   upgraded to send in place, so both sides recreate the connection —
//   the new one is born with the mic track attached. Muting stays
//   track.enabled — instant and renegotiation-free.
import type { MqttClient } from 'mqtt';
import { brokerOrder, connectMqttSequential, tryOneBroker } from './brokers';

/** ICE servers for the voice mesh (see the header note). Computed once
 *  per join; the TURN credential is time-limited (24h). */
async function turnIceServers(): Promise<RTCIceServer[]> {
  const stun: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const legacy: RTCIceServer[] = [
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ];
  try {
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const username = expiry + ':muse';
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('openrelayprojectsecret'),
      { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
    const credential = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return [...stun,
      { urls: 'turn:staticauth.openrelay.metered.ca:80', username, credential },
      { urls: 'turn:staticauth.openrelay.metered.ca:443', username, credential },
      { urls: 'turn:staticauth.openrelay.metered.ca:443?transport=tcp', username, credential },
      ...legacy,
    ];
  } catch {
    return [...stun, ...legacy];
  }
}


export interface VoiceHandle {
  /** Acquire the mic and start sending to the whole mesh. */
  enableMic(): Promise<void>;
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

export async function joinVoice(roomCode: string, myId: string, cb: VoiceCallbacks, gameId = 'cheese-thief', pinBroker?: string): Promise<VoiceHandle> {
  // TURN credentials are computed once here (see turnIceServers); the
  // peer connections below all share them.
  const iceServers = await turnIceServers();
  // Voice rides the same per-game topic tree as the game bus.
  const vTopic = (code: string, part: string) => `ct1/${gameId}/${code}/${part}`;
  // Listen-only by default: NO mic is requested to join the mesh.
  let stream: MediaStream | null = null;
  let micOn = false;

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
  const audios = new Set<HTMLAudioElement>();
  // Browsers (iOS Safari above all) refuse audio that starts without a
  // fresh user gesture — and the speaker now joins AUTOMATICALLY when a
  // room opens (v32), which may be outside a gesture handler. Any later
  // tap retries playback + resumes the analyser context.
  const unlockAudio = () => {
    audioCtx.resume().catch(() => { /* noop */ });
    audios.forEach(a => { a.play().catch(() => { /* still locked */ }); });
  };
  const peerIds = new Set<string>([myId]);
  // Who is in the voice mesh per PRESENCE (retained) — deliberately kept
  // separate from live peer connections, so a pair whose ICE failed can
  // be re-formed while its owner is still present.
  const present = new Set<string>();
  let left = false;

  const audioCtx = new AudioContext();
  audioCtx.resume().catch(() => { /* starts on the mic-click gesture anyway */ });
  document.addEventListener('pointerdown', unlockAudio);
  const analysers = new Map<string, AnalyserNode>();
  const makeAnalyser = (s: MediaStream): AnalyserNode => {
    const src = audioCtx.createMediaStreamSource(s);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    return an;
  };
  const enableMic = async () => {
    if (stream || left) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // The context was created at (automatic) speaker-join time and may be
    // suspended under autoplay rules; this call runs inside the mic tap —
    // a real user gesture — so resuming here reliably starts it (the
    // speaking analysers live on this context).
    try { await audioCtx.resume(); } catch { /* noop */ }
    micOn = true;
    analysers.set(myId, makeAnalyser(stream));
    // Rebuild every pair: the fresh connections are born with the track.
    for (const pid of [...peers.keys()]) {
      publish(vTopic(code, 'vs/' + pid), JSON.stringify({ from: myId, kind: 'reset' }), { qos: 1 });
      closePeer(pid);
      ensurePeer(pid);
      if (myId < pid) void makeOffer(pid);
    }
    publishPresence();
  };

  const publishPeers = () => cb.onPeers(new Set(peerIds));

  const closePeer = (pid: string) => {
    const p = peers.get(pid);
    if (!p) return;
    try { p.pc.close(); } catch { /* noop */ }
    try { p.audio.srcObject = null; p.audio.remove(); } catch { /* noop */ }
    audios.delete(p.audio);
    peers.delete(pid);
    analysers.delete(pid);
    peerIds.delete(pid);
    publishPeers();
  };

  const ensurePeer = (pid: string): Peer => {
    const existing = peers.get(pid);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers });
    if (stream) { const ms = stream; ms.getTracks().forEach(t => pc.addTrack(t, ms)); }
    else pc.addTransceiver('audio', { direction: 'recvonly' }); // listen-only until the mic is enabled
    const audio = document.createElement('audio');
    audios.add(audio);
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
      // Stale-handler guard (v48): closePeer/ensurePeer rebuilds the pair
      // synchronously (mic enable), but the OLD pc's 'closed'/'failed'
      // event can fire afterwards — it must not kill the NEW peer. Only
      // act when this pc is still the live one for pid.
      if (peers.get(pid)?.pc !== pc) return;
      if (pc.connectionState === 'failed') {
        closePeer(pid);
        // Self-heal: presence is retained and never redelivered, so a
        // dropped pair would stay dead forever without this. Re-form it
        // and re-announce so the counterpart rebuilds its side too.
        setTimeout(() => {
          if (left || peers.has(pid) || !present.has(pid)) return;
          ensurePeer(pid);
          if (myId < pid) void makeOffer(pid);
          publishPresence();
        }, 2000);
      } else if (pc.connectionState === 'closed') closePeer(pid);
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
  const publishPresence = () => publish(presenceTopic, JSON.stringify({ id: myId, ts: Date.now(), mic: micOn }), { retain: true, qos: 1 });

  function attach(c: MqttClient) {
    c.subscribe(vTopic(code, 'v/+'), { qos: 1 });
    c.subscribe(vTopic(code, 'vs/' + myId), { qos: 1 });
  c.on('message', async (topicName, payload) => {
    if (left) return;
    const text = payload.toString();
    if (topicName.startsWith(vTopic(code, 'v/'))) {
      const pid = topicName.slice(vTopic(code, 'v/').length);
      if (pid === myId) return;
      if (!text) { present.delete(pid); closePeer(pid); return; } // retained cleared / will fired
      present.add(pid);
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
    if (msg.kind === 'reset') {
      // Counterpart enabled their mic: rebuild the pair from scratch so
      // the new connection carries their track from the start.
      closePeer(from);
      ensurePeer(from);
      if (myId < from) void makeOffer(from);
      return;
    }
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
      failoverTimer = setTimeout(() => { failoverTimer = null; void failoverBus(); }, 3000);
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
      if (!failoverTimer && !left) failoverTimer = setTimeout(() => { failoverTimer = null; void failoverBus(); }, 3000);
    } finally { failoverBusy = false; }
  }

  // PIN (A9): when the caller knows the game bus's broker, go straight
  // there — the whole mesh gathers on the host's broker, so walking the
  // order from 0 could strand voice on a broker nobody else uses (and
  // cost up to ~16s when the first brokers are dead for this network).
  // Falls back to the sequential walk when the pin is absent or dead.
  const pinIdx = pinBroker ? order.indexOf(pinBroker) : -1;
  let r0: { client: MqttClient; idx: number } | null = null;
  if (pinIdx >= 0) {
    const pinned = await tryOneBroker(pinBroker!, busExtra());
    if (pinned) { (pinned as any).options.reconnectPeriod = 2000; r0 = { client: pinned, idx: pinIdx }; }
  }
  if (!r0) r0 = await connectMqttSequential(order, 0, busExtra());
  bus = r0.client; busIdx = r0.idx;
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
    enableMic,
    setMuted(muted: boolean) {
      stream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    },
    leave() {
      left = true;
      document.removeEventListener('pointerdown', unlockAudio);
      clearInterval(poll);
      try { publish(presenceTopic, '', { retain: true, qos: 1 }); } catch { /* noop */ }
      [...peers.keys()].forEach(closePeer);
      stream?.getTracks().forEach(t => t.stop());
      audioCtx.close().catch(() => { /* noop */ });
      if (failoverTimer) { clearTimeout(failoverTimer); failoverTimer = null; }
      const b = bus; bus = null;
      setTimeout(() => { try { b?.end(true); } catch { /* noop */ } }, 300);
    },
  };
}
