import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class RoomGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('webrtc-offer')
  async handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; offer: RTCSessionDescriptionInit; targetClientId?: string },
  ) {
    if (data.targetClientId) {
      this.server
        .to(data.targetClientId)
        .emit('webrtc-offer', { offer: data.offer, fromClientId: client.id });
    } else {
      client.to(data.roomId).emit('webrtc-offer', {
        offer: data.offer,
        fromClientId: client.id,
      });
    }
  }

  @SubscribeMessage('webrtc-answer')
  async handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; answer: RTCSessionDescriptionInit; targetClientId: string },
  ) {
    this.server.to(data.targetClientId).emit('webrtc-answer', {
      answer: data.answer,
      fromClientId: client.id,
    });
  }

  @SubscribeMessage('webrtc-ice-candidate')
  async handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; candidate: RTCIceCandidateInit; targetClientId: string },
  ) {
    this.server.to(data.targetClientId).emit('webrtc-ice-candidate', {
      candidate: data.candidate,
      fromClientId: client.id,
    });
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    client.join(data.roomId);
    client.to(data.roomId).emit('peer-joined', { clientId: client.id });
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    client.leave(data.roomId);
    client.to(data.roomId).emit('peer-left', { clientId: client.id });
  }
}
