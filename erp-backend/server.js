const express = require("express");
const mongoose = require("mongoose");
const QRCode = require("qrcode");
const crypto = require("crypto");
const path = require("path");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = "mysecretkey";

// =====================
// GPS CONFIG - CHANGE THIS
// =====================
const ALLOWED_LAT = 13.0847246;       // your classroom latitude
const ALLOWED_LNG = 77.4831032;       // your classroom longitude
const ALLOWED_RADIUS_METERS = 2000;   // testing: 500/1000, real: 50-150

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use(session({
    secret: "erp-admin-secret",
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, "public"), { index: false }));

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ MongoDB Error:", err));

// =====================
// Schemas
// =====================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "teacher", "student"], required: true },
    studentId: { type: String, default: "" },
    assignedSessions: { type: [String], default: [] }
});

const studentSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    className: { type: String, default: "CSE-A" },
    department: { type: String, default: "CSE" },
    faceDescriptor: { type: [Number], default: [] }
});

const subjectSchema = new mongoose.Schema({
    session: { type: String, required: true, unique: true },
    subjectName: { type: String, required: true },
    teacherUsername: { type: String, default: "" }
});

const timetableSchema = new mongoose.Schema({
    session: { type: String, required: true },
    dayOfWeek: { type: Number, required: true }, // 0 Sun, 1 Mon...
    startTime: { type: String, required: true }, // HH:MM
    endTime: { type: String, required: true }    // HH:MM
});

const attendanceSchema = new mongoose.Schema({
    studentId: String,
    studentName: String,
    className: String,
    session: String,
    subjectName: String,
    date: String,
    time: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
    latitude: Number,
    longitude: Number,
    distanceMeters: Number,
    faceVerified: { type: Boolean, default: false },
    blinkVerified: { type: Boolean, default: false },
    faceDistance: Number
});

const classSessionSchema = new mongoose.Schema({
    session: String,
    subjectName: String,
    date: String,
    teacherUsername: String
});

const suspiciousLogSchema = new mongoose.Schema({
    studentId: String,
    session: String,
    reason: String,
    ipAddress: String,
    userAgent: String,
    latitude: Number,
    longitude: Number,
    distanceMeters: Number,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Student = mongoose.model("Student", studentSchema);
const Subject = mongoose.model("Subject", subjectSchema);
const Timetable = mongoose.model("Timetable", timetableSchema);
const Attendance = mongoose.model("Attendance", attendanceSchema);
const ClassSession = mongoose.model("ClassSession", classSessionSchema);
const SuspiciousLog = mongoose.model("SuspiciousLog", suspiciousLogSchema);

// =====================
// Helpers
// =====================
function requireLogin(req, res, next) {
    if (req.session.user) return next();
    return res.redirect("/login.html");
}

function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === "admin") return next();
    return res.status(403).json({ success: false, message: "Admin only" });
}

function requireStaff(req, res, next) {
    if (req.session.user && ["admin", "teacher"].includes(req.session.user.role)) return next();
    return res.status(403).json({ success: false, message: "Access denied" });
}

function requireStudent(req, res, next) {
    if (req.session.user && req.session.user.role === "student") return next();
    return res.redirect("/login.html");
}

function teacherCanAccess(req, sessionName) {
    const user = req.session.user;
    if (!user) return false;
    if (user.role === "admin") return true;
    return Array.isArray(user.assignedSessions) && user.assignedSessions.includes(sessionName);
}

function todayISO() {
    return new Date().toISOString().split("T")[0];
}

function getClientIP(req) {
    return req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
}

async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = value => value * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
}

async function logSuspicious(req, details) {
    try {
        await SuspiciousLog.create({
            studentId: details.studentId || "",
            session: details.session || "",
            reason: details.reason || "Unknown",
            ipAddress: getClientIP(req),
            userAgent: req.headers["user-agent"] || "",
            latitude: details.latitude,
            longitude: details.longitude,
            distanceMeters: details.distanceMeters
        });
    } catch (err) {
        console.log("Suspicious log failed:", err.message);
    }
}

async function isSessionAllowedNow(sessionName) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = await Timetable.find({ session: sessionName, dayOfWeek });

    if (!slots.length) {
        return {
            allowed: false,
            message: "No timetable slot found for this session now"
        };
    }

    const allowed = slots.some(slot => {
        const start = timeToMinutes(slot.startTime);
        const end = timeToMinutes(slot.endTime);
        return currentMinutes >= start && currentMinutes <= end;
    });

    return {
        allowed,
        message: allowed ? "Allowed" : "Attendance is not allowed outside timetable"
    };
}

function sendExcel(res, rows, filename, sheetName) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
}

// =====================
// Pages
// =====================
app.get("/", (req, res) => res.redirect("/scanner.html"));

app.get("/admin.html", requireLogin, (req, res) => {
    if (["admin", "teacher"].includes(req.session.user.role)) {
        return res.sendFile(path.join(__dirname, "public", "admin.html"));
    }
    return res.redirect("/student.html");
});

app.get("/students.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "students.html"));
});

app.get("/subjects.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "subjects.html"));
});

app.get("/timetable.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "timetable.html"));
});

app.get("/percentage.html", requireStaff, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "percentage.html"));
});

app.get("/student.html", requireStudent, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "student.html"));
});

app.get("/enroll-face.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "enroll-face.html"));
});

// =====================
// Auth
// =====================
app.get("/reset-admin", async (req, res) => {
    try {
        await User.deleteOne({ username: "admin" });

        await User.create({
            username: "admin",
            passwordHash: await hashPassword("admin123"),
            role: "admin",
            studentId: "",
            assignedSessions: []
        });

        res.json({
            success: true,
            message: "Admin reset successfully. Login with admin / admin123"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });

        if (!user || !user.passwordHash) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        req.session.user = {
            username: user.username,
            role: user.role,
            studentId: user.studentId || "",
            assignedSessions: user.assignedSessions || []
        };

        res.json({
            success: true,
            role: user.role,
            redirect: user.role === "student" ? "/student.html" : "/admin.html"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login.html"));
});

// =====================
// Users
// =====================
app.get("/users", requireAdmin, async (req, res) => {
    const users = await User.find().sort({ role: 1, username: 1 });
    res.json(users);
});

app.post("/users", requireAdmin, async (req, res) => {
    try {
        const { username, password, role, studentId, assignedSessions } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Username, password and role are required"
            });
        }

        if (role === "student") {
            const student = await Student.findOne({ studentId });
            if (!student) {
                return res.status(404).json({
                    success: false,
                    message: "Student not found in master"
                });
            }
        }

        const exists = await User.findOne({ username });

        if (exists) {
            return res.status(400).json({
                success: false,
                message: "Username already exists"
            });
        }

        const user = await User.create({
            username,
            passwordHash: await hashPassword(password),
            role,
            studentId: role === "student" ? studentId : "",
            assignedSessions: role === "teacher" ? (assignedSessions || []) : []
        });

        res.json({ success: true, message: "User created", user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put("/users/:id/reset-password", requireAdmin, async (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ success: false, message: "Password required" });
    }

    await User.findByIdAndUpdate(req.params.id, {
        passwordHash: await hashPassword(password)
    });

    res.json({ success: true, message: "Password reset" });
});

app.delete("/users/:id", requireAdmin, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "User deleted" });
});

// =====================
// Students
// =====================
app.get("/seed-students", async (req, res) => {
    const sample = [
        { studentId: "S101", name: "John", className: "CSE-A", department: "CSE" },
        { studentId: "S102", name: "Priya N", className: "CSE-A", department: "CSE" },
        { studentId: "S103", name: "Rahul M", className: "CSE-A", department: "CSE" },
        { studentId: "S104", name: "Divya S", className: "CSE-A", department: "CSE" },
        { studentId: "S105", name: "Karthik R", className: "CSE-A", department: "CSE" }
    ];

    let inserted = 0;

    for (const s of sample) {
        const exists = await Student.findOne({ studentId: s.studentId });

        if (!exists) {
            await Student.create(s);
            inserted++;
        }
    }

    res.json({ success: true, message: `${inserted} students inserted` });
});

app.get("/students", requireStaff, async (req, res) => {
    const students = await Student.find().sort({ studentId: 1 });
    res.json(students);
});

app.post("/students", requireAdmin, async (req, res) => {
    const { studentId, name, className, department } = req.body;

    if (!studentId || !name) {
        return res.status(400).json({
            success: false,
            message: "Student ID and name required"
        });
    }

    const exists = await Student.findOne({ studentId });

    if (exists) {
        return res.status(400).json({
            success: false,
            message: "Student already exists"
        });
    }

    const student = await Student.create({
        studentId,
        name,
        className: className || "CSE-A",
        department: department || "CSE"
    });

    res.json({ success: true, message: "Student created", student });
});

app.delete("/students/:id", requireAdmin, async (req, res) => {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Student deleted" });
});

// =====================
// Face Enrollment
// =====================
app.post("/students/:studentId/face", requireAdmin, async (req, res) => {
    const { descriptor } = req.body;

    if (!Array.isArray(descriptor) || descriptor.length !== 128) {
        return res.status(400).json({
            success: false,
            message: "Invalid face descriptor"
        });
    }

    const student = await Student.findOneAndUpdate(
        { studentId: req.params.studentId },
        { faceDescriptor: descriptor },
        { new: true }
    );

    if (!student) {
        return res.status(404).json({
            success: false,
            message: "Student not found"
        });
    }

    res.json({
        success: true,
        message: "Face enrolled successfully"
    });
});

app.get("/students/:studentId/face", async (req, res) => {
    const student = await Student.findOne({ studentId: req.params.studentId });

    if (!student || !student.faceDescriptor || student.faceDescriptor.length !== 128) {
        return res.status(404).json({
            success: false,
            message: "Face not enrolled"
        });
    }

    res.json({
        success: true,
        studentId: student.studentId,
        name: student.name,
        descriptor: student.faceDescriptor
    });
});

// =====================
// Subjects
// =====================
app.get("/subjects", requireStaff, async (req, res) => {
    const subjects = await Subject.find().sort({ session: 1 });

    if (req.session.user.role === "teacher") {
        return res.json(subjects.filter(s => req.session.user.assignedSessions.includes(s.session)));
    }

    res.json(subjects);
});

app.post("/subjects", requireAdmin, async (req, res) => {
    const { session, subjectName, teacherUsername } = req.body;

    if (!session || !subjectName) {
        return res.status(400).json({
            success: false,
            message: "Session and subject name required"
        });
    }

    const exists = await Subject.findOne({ session });

    if (exists) {
        return res.status(400).json({
            success: false,
            message: "Session already exists"
        });
    }

    const subject = await Subject.create({
        session,
        subjectName,
        teacherUsername: teacherUsername || ""
    });

    res.json({ success: true, message: "Subject created", subject });
});

app.delete("/subjects/:id", requireAdmin, async (req, res) => {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Subject deleted" });
});

// =====================
// Timetable
// =====================
app.get("/timetables", requireStaff, async (req, res) => {
    const filter = {};
    if (req.query.session) filter.session = req.query.session;

    const data = await Timetable.find(filter).sort({ dayOfWeek: 1, startTime: 1 });
    res.json(data);
});

app.post("/timetables", requireAdmin, async (req, res) => {
    const { session, dayOfWeek, startTime, endTime } = req.body;

    if (!session || dayOfWeek === undefined || !startTime || !endTime) {
        return res.status(400).json({
            success: false,
            message: "session, dayOfWeek, startTime, endTime required"
        });
    }

    const subject = await Subject.findOne({ session });

    if (!subject) {
        return res.status(404).json({
            success: false,
            message: "Create subject/session first"
        });
    }

    const slot = await Timetable.create({
        session,
        dayOfWeek,
        startTime,
        endTime
    });

    res.json({ success: true, message: "Timetable slot added", slot });
});

app.delete("/timetables/:id", requireAdmin, async (req, res) => {
    await Timetable.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Timetable deleted" });
});

// =====================
// Class Sessions
// =====================
app.post("/class-session", requireStaff, async (req, res) => {
    const { session, date } = req.body;

    const subject = await Subject.findOne({ session });

    if (!subject) {
        return res.status(404).json({
            success: false,
            message: "Session not found in subject master"
        });
    }

    if (!teacherCanAccess(req, session)) {
        return res.status(403).json({
            success: false,
            message: "Not assigned to this session"
        });
    }

    const exists = await ClassSession.findOne({ session, date });

    if (exists) {
        return res.status(400).json({
            success: false,
            message: "Class session already exists"
        });
    }

    const data = await ClassSession.create({
        session,
        subjectName: subject.subjectName,
        date,
        teacherUsername: req.session.user.username
    });

    res.json({ success: true, message: "Class added", data });
});

// =====================
// QR
// =====================
async function generateQR(sessionName) {
    const subject = await Subject.findOne({ session: sessionName });

    if (!subject) {
        throw new Error("Invalid session");
    }

    const timeSlot = Math.floor(Date.now() / 30000);

    const data = JSON.stringify({
        session: sessionName,
        timeSlot
    });

    const hash = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
    const qrPayload = JSON.stringify({ data, hash });
    const qrImage = await QRCode.toDataURL(qrPayload);

    return { qrImage, data, hash, subject };
}

app.get("/qr-view", requireStaff, async (req, res) => {
    try {
        const sessionName = req.query.session || "CLASS101";

        if (!teacherCanAccess(req, sessionName)) {
            return res.send("Not assigned to this session");
        }

        const qr = await generateQR(sessionName);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>QR View</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { background:#111; color:white; font-family:Arial; text-align:center; padding:30px; }
                    img { width:320px; background:white; padding:12px; border-radius:10px; }
                    input,button { padding:10px; margin:8px; border-radius:6px; border:none; }
                    button { background:#28a745; color:white; cursor:pointer; }
                    a { color:lightgreen; }
                </style>
            </head>
            <body>
                <h2>QR Attendance</h2>
                <form method="GET" action="/qr-view">
                    <input name="session" value="${sessionName}">
                    <button>Load</button>
                </form>
                <h3>${qr.subject.subjectName} (${sessionName})</h3>
                <img src="${qr.qrImage}">
                <p>Refreshes in <span id="timer">30</span> seconds</p>
                <p><a href="/admin.html">Admin</a> | <a href="/logout">Logout</a></p>
                <script>
                    let s = 30;
                    setInterval(() => {
                        s--;
                        document.getElementById("timer").innerText = s;
                        if (s <= 0) location.reload();
                    }, 1000);
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        res.send(err.message);
    }
});

// =====================
// Attendance Mark
// =====================
app.post("/mark-attendance", async (req, res) => {
    try {
        const {
            data,
            hash,
            studentId,
            latitude,
            longitude,
            faceVerified,
            blinkVerified,
            faceDistance
        } = req.body;

        if (!data || !hash || !studentId) {
            await logSuspicious(req, { studentId, reason: "Missing QR or student data" });
            return res.status(400).json({ success: false, message: "Missing QR or student data" });
        }

        if (faceVerified !== true || blinkVerified !== true) {
            await logSuspicious(req, { studentId, reason: "Face/blink verification failed" });
            return res.status(400).json({ success: false, message: "Face and blink verification required" });
        }

        if (latitude === undefined || longitude === undefined) {
            await logSuspicious(req, { studentId, reason: "Location missing" });
            return res.status(400).json({ success: false, message: "Location permission required" });
        }

        const studentLat = Number(latitude);
        const studentLng = Number(longitude);

        const distance = calculateDistanceMeters(
            ALLOWED_LAT,
            ALLOWED_LNG,
            studentLat,
            studentLng
        );

        if (distance > ALLOWED_RADIUS_METERS) {
            await logSuspicious(req, {
                studentId,
                reason: "Outside GPS radius",
                latitude: studentLat,
                longitude: studentLng,
                distanceMeters: Math.round(distance)
            });

            return res.status(403).json({
                success: false,
                message: `You are outside allowed area. Distance: ${Math.round(distance)}m`
            });
        }

        const expectedHash = crypto.createHmac("sha256", SECRET).update(data).digest("hex");

        if (expectedHash !== hash) {
            await logSuspicious(req, { studentId, reason: "Invalid QR hash" });
            return res.status(400).json({ success: false, message: "Invalid QR" });
        }

        const parsed = JSON.parse(data);
        const currentSlot = Math.floor(Date.now() / 30000);

        if (parsed.timeSlot !== currentSlot) {
            await logSuspicious(req, { studentId, session: parsed.session, reason: "Expired QR" });
            return res.status(400).json({ success: false, message: "QR expired" });
        }

        const timetableCheck = await isSessionAllowedNow(parsed.session);

        if (!timetableCheck.allowed) {
            await logSuspicious(req, {
                studentId,
                session: parsed.session,
                reason: "Outside timetable"
            });

            return res.status(403).json({
                success: false,
                message: timetableCheck.message
            });
        }

        const subject = await Subject.findOne({ session: parsed.session });

        if (!subject) {
            return res.status(404).json({ success: false, message: "Session not found" });
        }

        const student = await Student.findOne({ studentId: studentId.trim() });

        if (!student) {
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        const today = todayISO();

        const classExists = await ClassSession.findOne({
            session: parsed.session,
            date: today
        });

        if (!classExists) {
            await ClassSession.create({
                session: parsed.session,
                subjectName: subject.subjectName,
                date: today,
                teacherUsername: subject.teacherUsername || ""
            });
        }

        const existing = await Attendance.findOne({
            studentId: student.studentId,
            session: parsed.session,
            date: today
        });

        if (existing) {
            await logSuspicious(req, {
                studentId: student.studentId,
                session: parsed.session,
                reason: "Duplicate attempt"
            });

            return res.status(400).json({ success: false, message: "Already marked today" });
        }

        const saved = await Attendance.create({
            studentId: student.studentId,
            studentName: student.name,
            className: student.className,
            session: parsed.session,
            subjectName: subject.subjectName,
            date: today,
            time: new Date(),
            ipAddress: getClientIP(req),
            userAgent: req.headers["user-agent"] || "",
            latitude: studentLat,
            longitude: studentLng,
            distanceMeters: Math.round(distance),
            faceVerified: true,
            blinkVerified: true,
            faceDistance: Number(faceDistance || 0)
        });

        res.json({
            success: true,
            message: "Attendance marked",
            studentName: saved.studentName,
            student: saved.studentId,
            className: saved.className,
            session: saved.session,
            subjectName: saved.subjectName,
            date: saved.date,
            distanceMeters: saved.distanceMeters
        });
    } catch (err) {
        console.log("❌ Mark attendance error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// =====================
// Reports
// =====================
app.get("/attendance", requireStaff, async (req, res) => {
    const { studentId, session, date, from, to } = req.query;
    const filter = {};

    if (studentId) filter.studentId = studentId;
    if (session) filter.session = session;
    if (date) filter.date = date;

    if (from || to) {
        filter.date = {};
        if (from) filter.date.$gte = from;
        if (to) filter.date.$lte = to;
    }

    if (req.session.user.role === "teacher") {
        if (session && req.session.user.assignedSessions.includes(session)) {
            filter.session = session;
        } else {
            filter.session = { $in: req.session.user.assignedSessions };
        }
    }

    const data = await Attendance.find(filter).sort({ time: -1 });
    res.json(data);
});

app.delete("/attendance/:id", requireStaff, async (req, res) => {
    await Attendance.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Attendance deleted" });
});

async function calculatePercentageForStudent(student, sessionName) {
    const totalClasses = await ClassSession.countDocuments({ session: sessionName });

    const attendedDates = await Attendance.distinct("date", {
        studentId: student.studentId,
        session: sessionName
    });

    const attendedClasses = attendedDates.length;

    const percentage = totalClasses === 0
        ? 0
        : Math.min((attendedClasses / totalClasses) * 100, 100);

    return {
        studentId: student.studentId,
        studentName: student.name,
        className: student.className,
        session: sessionName,
        attendedClasses,
        totalClasses,
        percentage: Number(percentage.toFixed(2)),
        status: percentage >= 75 ? "Good" : percentage >= 50 ? "Warning" : "Shortage"
    };
}

app.get("/attendance-percentages", requireStaff, async (req, res) => {
    const sessionName = req.query.session || "CLASS101";

    if (!teacherCanAccess(req, sessionName)) {
        return res.status(403).json({
            success: false,
            message: "Not assigned to this session"
        });
    }

    const students = await Student.find().sort({ studentId: 1 });
    const result = [];

    for (const student of students) {
        result.push(await calculatePercentageForStudent(student, sessionName));
    }

    res.json(result);
});

app.get("/student-history/:studentId", requireStaff, async (req, res) => {
    const filter = { studentId: req.params.studentId };

    if (req.query.session) filter.session = req.query.session;

    const data = await Attendance.find(filter).sort({ time: -1 });
    res.json(data);
});

app.get("/my-attendance", requireStudent, async (req, res) => {
    const sessionName = req.query.session || "CLASS101";

    const student = await Student.findOne({
        studentId: req.session.user.studentId
    });

    if (!student) {
        return res.status(404).json({
            success: false,
            message: "Student not found"
        });
    }

    const percentage = await calculatePercentageForStudent(student, sessionName);

    const history = await Attendance.find({
        studentId: student.studentId,
        session: sessionName
    }).sort({ time: -1 });

    res.json({ success: true, percentage, history });
});

app.get("/dashboard-stats", requireStaff, async (req, res) => {
    const today = todayISO();

    const totalStudents = await Student.countDocuments();
    const todayAttendance = await Attendance.countDocuments({ date: today });
    const totalSessions = await ClassSession.countDocuments();
    const suspiciousCount = await SuspiciousLog.countDocuments();

    let lowAttendance = 0;

    const subjects = await Subject.find();
    const students = await Student.find();

    for (const subject of subjects) {
        for (const student of students) {
            const p = await calculatePercentageForStudent(student, subject.session);
            if (p.percentage < 75) lowAttendance++;
        }
    }

    res.json({
        totalStudents,
        todayAttendance,
        totalSessions,
        lowAttendance,
        suspiciousCount
    });
});

app.get("/suspicious-logs", requireStaff, async (req, res) => {
    const logs = await SuspiciousLog.find().sort({ createdAt: -1 }).limit(100);
    res.json(logs);
});

// =====================
// Excel Export
// =====================
app.get("/export-attendance", requireStaff, async (req, res) => {
    const data = await Attendance.find().sort({ time: -1 });

    const rows = data.map(x => ({
        "Student ID": x.studentId,
        "Name": x.studentName,
        "Class": x.className,
        "Session": x.session,
        "Subject": x.subjectName,
        "Date": x.date,
        "Time": x.time,
        "IP": x.ipAddress,
        "Latitude": x.latitude,
        "Longitude": x.longitude,
        "Distance Meters": x.distanceMeters,
        "Face Verified": x.faceVerified,
        "Blink Verified": x.blinkVerified,
        "Face Distance": x.faceDistance,
        "Device": x.userAgent
    }));

    sendExcel(res, rows, "attendance.xlsx", "Attendance");
});

app.get("/export-percentages", requireStaff, async (req, res) => {
    const sessionName = req.query.session || "CLASS101";

    const students = await Student.find();
    const rows = [];

    for (const student of students) {
        const p = await calculatePercentageForStudent(student, sessionName);
        rows.push({
            "Student ID": p.studentId,
            "Name": p.studentName,
            "Class": p.className,
            "Session": p.session,
            "Attended": p.attendedClasses,
            "Total": p.totalClasses,
            "Percentage": p.percentage,
            "Status": p.status
        });
    }

    sendExcel(res, rows, "attendance-percentages.xlsx", "Percentages");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});