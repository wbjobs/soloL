import client from './client';
import type { Room, CreateRoomRequest, JoinRoomRequest, ApiResponse } from '../types';

export async function createRoom(req: CreateRoomRequest): Promise<Room> {
  const response = await client.post<ApiResponse<Room>>('/rooms', req);
  return response.data.data;
}

export async function joinRoom(req: JoinRoomRequest): Promise<Room> {
  const response = await client.post<ApiResponse<Room>>(`/rooms/${req.roomId}/join`, {
    userName: req.userName,
  });
  return response.data.data;
}

export async function leaveRoom(roomId: string): Promise<void> {
  await client.post(`/rooms/${roomId}/leave`);
}

export async function getRoom(id: string): Promise<Room> {
  const response = await client.get<ApiResponse<Room>>(`/rooms/${id}`);
  return response.data.data;
}
