export const DEFAULT_ABC_SCORE = `T:Twinkle Twinkle Little Star
C:Mozart
M:4/4
L:1/8
Q:1/4=120
K:C
|: c c g g | a a g2 | f f e e | d d c2 |
   g g f f | e e d2 | g g f f | e e d2 |
   c c g g | a a g2 | f f e e | d d c2 :|
`;

export const LOCK_DURATION = 3000;
export const CURSOR_SYNC_INTERVAL = 100;
export const MAX_HISTORY_VERSIONS = 50;

export const HEARTBEAT_INTERVAL = 10000;
export const HEARTBEAT_TIMEOUT = 30000;

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const WEBRTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
};

export const DATA_CHANNEL_OPTIONS = {
  ordered: true,
  maxRetransmits: 3,
};
