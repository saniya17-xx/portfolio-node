if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}

const nodemailer = require("nodemailer");

const http = require("http");
const { Server } = require("socket.io");

const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");
const fs = require("fs");
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


let chatHistory = {};

if (fs.existsSync("chatHistory.json")) {
    const data = fs.readFileSync("chatHistory.json", "utf8");

    if (data) {
        try {
            chatHistory = JSON.parse(data);
        } catch (err) {
            chatHistory = {};
        }
    }
}


const app = express();
const server = http.createServer(app);
const io = new Server(server);


// -------------------
// Middleware
// -------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// -------------------
// Admin User (AFTER bcrypt is loaded)
// -------------------
const adminUser = {
    username: "admin",
    passwordHash: bcrypt.hashSync("password123", 10)
};

// -------------------
// Auth Middleware
// -------------------
function requireAuth(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect("/admin/login");
    }
}

// -------------------
// Routes
// -------------------

app.get("/", (req, res) => {
    res.render("home");
});

// Contact Form
app.post("/contact", (req, res) => {
    const { name, email, message } = req.body;

    const newMessage = {
        name,
        email,
        message,
        date: new Date().toISOString()
    };

    let messages = [];

    if (fs.existsSync("messages.json")) {
        const data = fs.readFileSync("messages.json");
        messages = JSON.parse(data);
    }

    messages.push(newMessage);

    fs.writeFileSync("messages.json", JSON.stringify(messages, null, 2));

    res.status(200).send("Success");
});

// -------------------
// Admin Routes
// -------------------

app.get("/admin/login", (req, res) => {
    res.render("admin-login");
});

app.post("/admin/login", async (req, res) => {
    const { username, password } = req.body;

    if (
        username === adminUser.username &&
        await bcrypt.compare(password, adminUser.passwordHash)
    ) {
        req.session.isAuthenticated = true;
        res.redirect("/admin/dashboard");
    } else {
        res.send("Invalid credentials");
    }
});

app.get("/admin/dashboard", requireAuth, (req, res) => {
    let messages = [];

    if (fs.existsSync("messages.json")) {
        const data = fs.readFileSync("messages.json");
        messages = JSON.parse(data);
    }

    res.render("admin-dashboard", { messages });
});

app.get("/admin/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/admin/login");
    });
});

// -------------------
// Start Server
// -------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port " + PORT);
});

// -------------------
// Socket.IO Logic
// -------------------

// -------------------
// Socket.IO Logic
// -------------------
let users = {};
let admins = new Set();


io.on("connection", (socket) => {
        // -------- REGISTER ADMIN --------
    socket.on("registerAdmin", () => {
        admins.add(socket.id);

        // Send current active users to this admin
        socket.emit("updateUserList", Object.values(users));
    });

    console.log("Connected:", socket.id);

    // ---------------- REGISTER VISITOR ----------------
    socket.on("registerVisitor", (data) => {

        users[socket.id] = {
            id: socket.id,
            name: data.name
        };

        if (!chatHistory[socket.id]) {
            chatHistory[socket.id] = [];
        }

        admins.forEach(adminId => {
    io.to(adminId).emit("updateUserList", Object.values(users));
});

    });

    // ---------------- VISITOR MESSAGE ----------------
    socket.on("visitorMessage", (data) => {

    if (!users[socket.id]) return;

    const userName = users[socket.id].name;

    if (!chatHistory[socket.id]) {
        chatHistory[socket.id] = [];
    }

    chatHistory[socket.id].push({
        sender: userName,
        message: data.message,
        time: new Date().toLocaleTimeString()
    });

    fs.writeFileSync("chatHistory.json", JSON.stringify(chatHistory, null, 2));

    io.emit("adminReceiveMessage", {
        from: socket.id,
        name: userName,
        message: data.message
    });

    // EMAIL NOTIFICATION
    transporter.sendMail({
        from: "Portfolio Chat <toxic@gmail.com>",
        to: "toxicsaniya@gmail.com",
        subject: "New Chat Message",
        text: `New message from: ${userName}\n\nMessage:\n${data.message}`
    });
});


    // ---------------- ADMIN MESSAGE ----------------
    socket.on("adminMessage", (data) => {

        if (!chatHistory[data.to]) {
            chatHistory[data.to] = [];
        }

        const messageObj = {
            sender: "Admin",
            message: data.message,
            time: new Date().toLocaleTimeString()
        };

        chatHistory[data.to].push(messageObj);

        fs.writeFileSync("chatHistory.json", JSON.stringify(chatHistory, null, 2));

        io.to(data.to).emit("visitorReceiveMessage", {
            message: data.message
        });
    });

    // ---------------- GET CHAT HISTORY ----------------
    socket.on("getChatHistory", (userId) => {

        console.log("Sending history for:", userId);

        socket.emit("chatHistoryData", chatHistory[userId] || []);
    });

    // ---------------- DISCONNECT ----------------
    socket.on("disconnect", () => {

    // If visitor disconnected
    if (users[socket.id]) {
        delete users[socket.id];

        admins.forEach(adminId => {
            io.to(adminId).emit("updateUserList", Object.values(users));
        });
    }

    // If admin disconnected
    if (admins.has(socket.id)) {
        admins.delete(socket.id);
    }
});

});
