const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let waitingQueue = []; 

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join_queue", () => {
        if (waitingQueue.length > 0) {
            const partnerSocket = waitingQueue.pop(); 
            const roomId = `${socket.id}#${partnerSocket.id}`;

            socket.join(roomId);
            partnerSocket.join(roomId);

            io.to(socket.id).emit("match_found", { roomId, initiator: true });
            io.to(partnerSocket.id).emit("match_found", { roomId, initiator: false });

            console.log(`Matched ${socket.id} with ${partnerSocket.id}`);
        } else {
            waitingQueue.push(socket);
            console.log(`User ${socket.id} added to queue.`);
        }
    });

    socket.on("signal", (data) => {
        socket.to(data.roomId).emit("signal", data.signalData);
    });

    socket.on("disconnect", () => {
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));