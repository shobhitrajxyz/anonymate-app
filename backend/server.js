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

// --- 1. USER COUNT LOGIC ---
function broadcastUserCount() {
    const count = io.engine.clientsCount;
    io.emit("user_count", count);
    console.log(`Live Users: ${count}`);
}

// --- 2. COUNTRY DETECTION LOGIC ---
async function getCountry(ip) {
    try {
        // Handle Localhost
        if (ip === "::1" || ip === "127.0.0.1") return "Local Dev";
        
        // Fetch Country from Free API
        const response = await fetch(`http://ip-api.com/json/${ip}`);
        const data = await response.json();
        return data.country || "Unknown";
    } catch (error) {
        return "Unknown";
    }
}

io.on("connection", async (socket) => {
    // A. User Joined -> Update Count
    broadcastUserCount();

    // B. Detect Country
    let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    if (clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
    
    const country = await getCountry(clientIp);
    socket.userData = { country: country };
    console.log(`Connected: ${socket.id} from ${country}`);

    // C. Handle Matchmaking
    socket.on("join_queue", () => {
        if (waitingQueue.length > 0) {
            // Found a partner!
            const partnerSocket = waitingQueue.pop(); 
            
            // Create a simple Room Name (Just a string)
            const roomId = `${socket.id}#${partnerSocket.id}`;

            // We don't need socket.join() for Agora, but we do it for internal tracking
            socket.join(roomId);
            partnerSocket.join(roomId);

            // Notify User 1
            io.to(socket.id).emit("match_found", { 
                roomId, 
                initiator: true, 
                partnerCountry: partnerSocket.userData.country 
            });
            
            // Notify User 2
            io.to(partnerSocket.id).emit("match_found", { 
                roomId, 
                initiator: false, 
                partnerCountry: socket.userData.country 
            });

            console.log(`Matched: ${country} <--> ${partnerSocket.userData.country}`);
        } else {
            // No one waiting, put in queue
            waitingQueue.push(socket);
        }
    });

    // NOTE: We REMOVED socket.on('signal') because Agora handles audio signaling now!

    socket.on("disconnect", () => {
        // Remove from queue if they leave
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
        broadcastUserCount();
        console.log(`Disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`AnonyMate Server running on port ${PORT}`));