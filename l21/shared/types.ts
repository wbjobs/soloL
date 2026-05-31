export interface User {
  id: string;
  name: string;
  color: string;
  cursor?: { line: number; ch: number };
  selection?: { anchor: Position; head: Position };
  connectedAt: number;
}

export interface Position {
  line: number;
  ch: number;
}

export interface EditorChange {
  from: Position;
  to: Position;
  text: string[];
  origin?: string;
}

export interface LockedSection {
  id: string;
  roomId: string;
  startLine: number;
  endLine: number;
  lockedBy: string;
  lockedByUserName: string;
  lockedAt: number;
  expiresAt: number;
}

export interface ScoreVersion {
  id: string;
  roomId: string;
  version: number;
  content: string;
  message: string;
  userId: string;
  userName: string;
  createdAt: number;
}

export interface RoomState {
  id: string;
  name: string;
  users: User[];
  currentContent: string;
  currentVersion: number;
  lockedSections: LockedSection[];
}

export interface SignalingMessage {
  type: string;
  roomId: string;
  userId: string;
  timestamp: number;
}

export interface OfferMessage extends SignalingMessage {
  type: 'offer';
  targetId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerMessage extends SignalingMessage {
  type: 'answer';
  targetId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateMessage extends SignalingMessage {
  type: 'ice-candidate';
  targetId: string;
  candidate: RTCIceCandidateInit;
}

export interface JoinRoomMessage extends SignalingMessage {
  type: 'join-room';
  userName: string;
}

export interface RoomStateMessage extends SignalingMessage {
  type: 'room-state';
  users: User[];
  currentScore: string;
  currentVersion: number;
  lockedSections: LockedSection[];
}

export interface UserJoinedMessage extends SignalingMessage {
  type: 'user-joined';
  user: User;
}

export interface UserLeftMessage extends SignalingMessage {
  type: 'user-left';
  userId: string;
}

export interface DataChannelMessage {
  type: string;
  userId: string;
  timestamp: number;
}

export interface CursorMessage extends DataChannelMessage {
  type: 'cursor';
  position: { line: number; ch: number };
  selection?: { anchor: Position; head: Position };
}

export interface ContentChangeMessage extends DataChannelMessage {
  type: 'content-change';
  changes: EditorChange[];
  version: number;
}

export interface SectionLockMessage extends DataChannelMessage {
  type: 'section-lock';
  sectionId: string;
  locked: boolean;
  range: { start: number; end: number };
}

export interface SaveVersionMessage extends DataChannelMessage {
  type: 'save-version';
  content: string;
  message: string;
}

export interface VersionSavedMessage extends DataChannelMessage {
  type: 'version-saved';
  version: ScoreVersion;
}

export interface MidiPlayMessage extends DataChannelMessage {
  type: 'midi-play';
  startNote?: number;
}

export interface MidiStopMessage extends DataChannelMessage {
  type: 'midi-stop';
}

export interface MidiSeekMessage extends DataChannelMessage {
  type: 'midi-seek';
  noteIndex: number;
}

export interface HeartbeatMessage extends SignalingMessage {
  type: 'heartbeat';
}

export interface LocksReleasedMessage extends SignalingMessage {
  type: 'locks-released';
  userId: string;
  releasedSectionIds: string[];
}

export type PeerMessage =
  | CursorMessage
  | ContentChangeMessage
  | SectionLockMessage
  | SaveVersionMessage
  | VersionSavedMessage
  | MidiPlayMessage
  | MidiStopMessage
  | MidiSeekMessage;

export type SignalingMessageUnion =
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | JoinRoomMessage
  | RoomStateMessage
  | UserJoinedMessage
  | UserLeftMessage
  | HeartbeatMessage
  | LocksReleasedMessage;
