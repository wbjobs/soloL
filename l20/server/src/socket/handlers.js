export function setupSocketHandlers(io, rooms) {
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', async ({ roomId, userId }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { users: new Map(), backgrounds: [] });
      }
      
      const room = rooms.get(roomId);
      room.users.set(socket.id, { userId, socketId: socket.id });
      
      socket.to(roomId).emit('user-joined', { userId, socketId: socket.id });
      
      const users = Array.from(room.users.values());
      io.to(roomId).emit('room-users', users);
    });

    socket.on('background-update', ({ roomId, background }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.backgrounds.push(background);
        socket.to(roomId).emit('background-updated', background);
      }
    });

    socket.on('offer', ({ targetId, offer }) => {
      socket.to(targetId).emit('offer', { from: socket.id, offer });
    });

    socket.on('answer', ({ targetId, answer }) => {
      socket.to(targetId).emit('answer', { from: socket.id, answer });
    });

    socket.on('ice-candidate', ({ targetId, candidate }) => {
      socket.to(targetId).emit('ice-candidate', { from: socket.id, candidate });
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      rooms.forEach((room, roomId) => {
        if (room.users.has(socket.id)) {
          room.users.delete(socket.id);
          socket.to(roomId).emit('user-left', { socketId: socket.id });
          
          if (room.users.size === 0) {
            rooms.delete(roomId);
          }
        }
      });
    });
  });
}
