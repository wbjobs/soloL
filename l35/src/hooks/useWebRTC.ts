import { useRef, useState, useCallback, useEffect } from "react";
import type { SignalingMessage } from "@/types";

type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

interface WebRTCResult {
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
  connectionState: ConnectionState;
  reconnectAttempts: number;
  nextRetryIn: number;
  connect: (sourceId: string) => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
}

const INITIAL_DELAY = 1000;
const MAX_DELAY = 60000;
const MULTIPLIER = 2;
const HEARTBEAT_INTERVAL = 10000;
const HEARTBEAT_TIMEOUT = 5000;
const SIGNALING_TIMEOUT = 10000;
const ICE_GATHERING_TIMEOUT = 15000;

export function useWebRTC(): WebRTCResult {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sourceIdRef = useRef<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [nextRetryIn, setNextRetryIn] = useState(0);

  const timersRef = useRef<Record<string, number | null>>({
    reconnect: null, heartbeat: null, heartbeatTimeout: null, signaling: null, ice: null,
  });
  const attemptCountRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const connectInternalRef = useRef<(() => Promise<void>) | null>(null);

  const clearTimers = useCallback(() => {
    const t = timersRef.current;
    Object.keys(t).forEach((k) => {
      if (t[k]) {
        if (k === "heartbeat") clearInterval(t[k]!);
        else clearTimeout(t[k]!);
        t[k] = null;
      }
    });
  }, []);

  const calcBackoff = useCallback((n: number): number => {
    const d = Math.min(INITIAL_DELAY * Math.pow(MULTIPLIER, n), MAX_DELAY);
    return Math.max(INITIAL_DELAY, d + d * 0.1 * (Math.random() * 2 - 1));
  }, []);

  const resetBackoff = useCallback(() => {
    attemptCountRef.current = 0;
    setReconnectAttempts(0);
    setNextRetryIn(0);
  }, []);

  const cleanup = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimers();
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setStream(null);
    setNextRetryIn(0);
  }, [clearTimers]);

  const triggerReconnect = useCallback(() => {
    const t = timersRef.current;
    if (!shouldReconnectRef.current || t.reconnect) return;
    const delay = calcBackoff(attemptCountRef.current);
    attemptCountRef.current++;
    setReconnectAttempts(attemptCountRef.current);
    setConnectionState("reconnecting");
    setNextRetryIn(delay);
    t.reconnect = window.setTimeout(async () => {
      t.reconnect = null;
      setNextRetryIn(0);
      if (shouldReconnectRef.current && connectInternalRef.current) {
        await connectInternalRef.current();
      }
    }, delay);
  }, [calcBackoff]);

  const startHeartbeat = useCallback(() => {
    const t = timersRef.current;
    if (t.heartbeat) clearInterval(t.heartbeat);
    t.heartbeat = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
        if (t.heartbeatTimeout) clearTimeout(t.heartbeatTimeout);
        t.heartbeatTimeout = window.setTimeout(() => {
          if (shouldReconnectRef.current) triggerReconnect();
        }, HEARTBEAT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, [triggerReconnect]);

  const connectInternal = useCallback(async () => {
    if (!sourceIdRef.current) return;
    clearTimers();
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setConnectionState("connecting");

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;

    pc.ontrack = (e) => e.streams?.[0] && setStream(e.streams[0]);
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "disconnected" || s === "failed" || s === "closed") {
        if (shouldReconnectRef.current) triggerReconnect();
      } else if (s === "connected" || s === "completed") {
        setConnectionState("connected");
        resetBackoff();
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        if (shouldReconnectRef.current) triggerReconnect();
      } else if (s === "connected") {
        setConnectionState("connected");
        resetBackoff();
      }
    };
    pc.onicegatheringstatechange = () => {};
    pc.onsignalingstatechange = () => {};
    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "ice-candidate", sourceId: sourceIdRef.current, candidate: e.candidate.toJSON(),
        } as SignalingMessage));
      }
    };

    timersRef.current.ice = window.setTimeout(() => {
      if (!["connected", "completed"].includes(pc.iceConnectionState) && shouldReconnectRef.current) {
        triggerReconnect();
      }
    }, ICE_GATHERING_TIMEOUT);

    timersRef.current.signaling = window.setTimeout(() => {
      if (pc.connectionState !== "connected" && shouldReconnectRef.current) {
        triggerReconnect();
      }
    }, SIGNALING_TIMEOUT);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = async (e) => {
      if (e.data === "pong") {
        if (timersRef.current.heartbeatTimeout) {
          clearTimeout(timersRef.current.heartbeatTimeout);
          timersRef.current.heartbeatTimeout = null;
        }
        return;
      }
      try {
        const msg: SignalingMessage = JSON.parse(e.data);
        if (msg.type === "answer" && msg.sdp && pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          if (timersRef.current.signaling) {
            clearTimeout(timersRef.current.signaling);
            timersRef.current.signaling = null;
          }
        } else if (msg.type === "ice-candidate" && msg.candidate && pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
      } catch { void 0; }
    };

    ws.onopen = async () => {
      startHeartbeat();
      try {
        pc.addTransceiver("video", { direction: "recvonly" });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: "offer", sourceId: sourceIdRef.current, sdp: offer,
        } as SignalingMessage));
      } catch {
        if (shouldReconnectRef.current) triggerReconnect();
      }
    };

    ws.onerror = () => {
      if (shouldReconnectRef.current) triggerReconnect();
    };
    ws.onclose = () => {
      const t = timersRef.current;
      if (t.heartbeat) { clearInterval(t.heartbeat); t.heartbeat = null; }
      if (t.heartbeatTimeout) { clearTimeout(t.heartbeatTimeout); t.heartbeatTimeout = null; }
      if (shouldReconnectRef.current) triggerReconnect();
    };
  }, [clearTimers, resetBackoff, startHeartbeat, triggerReconnect]);

  useEffect(() => {
    connectInternalRef.current = connectInternal;
  }, [connectInternal]);

  const connect = useCallback(async (sourceId: string) => {
    if (!sourceId) return;
    sourceIdRef.current = sourceId;
    shouldReconnectRef.current = true;
    resetBackoff();
    await connectInternal();
  }, [connectInternal, resetBackoff]);

  const disconnect = useCallback(() => {
    cleanup();
    setConnectionState("disconnected");
  }, [cleanup]);

  const reconnect = useCallback(async () => {
    const t = timersRef.current;
    if (t.reconnect) { clearTimeout(t.reconnect); t.reconnect = null; }
    resetBackoff();
    shouldReconnectRef.current = true;
    await connectInternal();
  }, [connectInternal, resetBackoff]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    pc: pcRef.current, stream, connectionState, reconnectAttempts, nextRetryIn,
    connect, disconnect, reconnect,
  };
}
