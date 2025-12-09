const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let waitingQueue = []; 

// Helper function to get Country from IP
async function getCountry(ip) {
    try {
        // If running locally, IP might be "::1", so we default to "Localhost"
        if (ip === "::1" || ip === "127.0.0.1") return "Local Dev";
        
        // Free API to look up country
        const response = await fetch(`http://ip-api.com/json/${ip}`);
        const data = await response.json();
        return data.country || "Unknown";
    } catch (error) {
        return "Unknown";
    }
}



// ... existing imports ...

// Helper to send the count to everyone
function broadcastUserCount() {
    // io.engine.clientsCount is a built-in feature of Socket.io
    // It gives us the exact number of connected people
    const count = io.engine.clientsCount;
    
    // "io.emit" sends a message to EVERYONE connected (Global Broadcast)
    io.emit("user_count", count); 
}



io.on("connection", async (socket) => {


    broadcastUserCount();


    // 1. Get User's IP
    let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    // On Render, IP might look like "1.2.3.4, 10.0.0.1". We want the first one.
    if (clientIp && clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
    }

    // 2. Find their Country
    const country = await getCountry(clientIp);
    socket.userData = { country: country };
    
    console.log(`User connected from: ${country} (${socket.id})`);

    socket.on("join_queue", () => {
        if (waitingQueue.length > 0) {
            const partnerSocket = waitingQueue.pop(); 
            const roomId = `${socket.id}#${partnerSocket.id}`;

            socket.join(roomId);
            partnerSocket.join(roomId);

            // 3. Send the PARTNER'S country to the user
            io.to(socket.id).emit("match_found", { 
                roomId, 
                initiator: true, 
                partnerCountry: partnerSocket.userData.country 
            });
            
            io.to(partnerSocket.id).emit("match_found", { 
                roomId, 
                initiator: false, 
                partnerCountry: socket.userData.country 
            });

            console.log(`Matched: ${socket.userData.country} <-> ${partnerSocket.userData.country}`);
        } else {
            waitingQueue.push(socket);
        }
    });

    socket.on("signal", (data) => {
        socket.to(data.roomId).emit("signal", data.signalData);
    });

    socket.on("disconnect", () => {
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);


        broadcastUserCount();
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));