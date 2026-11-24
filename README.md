# 🎓 ERP Attendance Management System

A web-based **ERP Attendance Management System** designed to simplify classroom attendance tracking, student management, timetable administration, and attendance reporting.

The system uses dynamic QR codes, face and blink verification, and GPS-based location validation to help reduce fraudulent attendance marking.

## 🌐 Live Demo

**Application:** https://erp-attendance-qpva.onrender.com

**GitHub Repository:** https://github.com/nivedakshaya/erp-attendance

## ✨ Features

### 1. Attendance Management
- QR-code-based attendance marking.
- Dynamic QR codes that refresh every 30 seconds.
- Face verification and blink verification.
- GPS-based location validation.
- Duplicate attendance prevention.
- Automatic suspicious activity logging.

### 2. Student Management
- Add and manage student records.
- Maintain student IDs, names, classes, and departments.
- Face enrollment for students.
- View individual attendance history.

### 3. Teacher Management
- Role-based teacher access.
- Assign teachers to specific sessions.
- Manage classroom sessions.
- View attendance records for assigned sessions.

### 4. Admin Dashboard
- Manage students, teachers, and users.
- Create and manage subjects.
- Configure class timetables.
- Monitor attendance statistics.
- Track suspicious attendance attempts.

### 5. Attendance Reports
- Calculate individual attendance percentages.
- Identify students with low attendance.
- View attendance history.
- Export attendance records to Excel.
- Export attendance percentage reports.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | Backend runtime |
| Express.js | Backend framework |
| MongoDB Atlas | Cloud database |
| Mongoose | Database management |
| JavaScript | Application logic |
| HTML, CSS | Frontend |
| QRCode | QR code generation |
| bcryptjs | Password hashing |
| XLSX | Excel report generation |

## 🏗️ Project Structure

```text
erp-attendance/
│
└── erp-backend/
    │
    ├── public/
    │   ├── login.html
    │   ├── admin.html
    │   ├── student.html
    │   ├── scanner.html
    │   ├── students.html
    │   ├── subjects.html
    │   ├── timetable.html
    │   ├── percentage.html
    │   └── enroll-face.html
    │
    ├── server.js
    ├── package.json
    └── package-lock.json
```

## ⚙️ Installation and Setup

### Prerequisites

- Node.js and npm
- MongoDB Atlas account
- Git

### 1. Clone the repository

```bash
git clone https://github.com/nivedakshaya/erp-attendance.git
```

### 2. Navigate to the backend folder

```bash
cd erp-attendance/erp-backend
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file or configure the environment variables in your hosting platform.

Required variable:

```env
MONGO_URI=your_mongodb_connection_string
PORT=3000
```

Use your MongoDB Atlas connection string and keep database credentials private.

### 5. Start the application

```bash
npm start
```

The application will run locally at:

```text
http://localhost:3000
```

## 🗄️ Database Structure

The application uses MongoDB collections for:

- Users
- Students
- Subjects
- Timetables
- Class Sessions
- Attendance
- Suspicious Logs

## 🔐 User Roles

| Role | Access |
|---|---|
| Admin | Full system administration |
| Teacher | Manage assigned sessions and view reports |
| Student | Mark attendance and view personal attendance records |

## ☁️ Deployment

The application is deployed using:

- **GitHub:** Source code management
- **Render:** Backend hosting
- **MongoDB Atlas:** Cloud database hosting

Environment variables are configured through the Render dashboard.

## 🔒 Security Considerations

- Database credentials should never be committed to GitHub.
- Authentication secrets should be stored in environment variables.
- Administrative and database-management endpoints should be protected.
- Production deployments should use secure session configuration and HTTPS.

## 🎯 Project Objective

The primary objective of this project is to develop a reliable and efficient attendance management solution that combines QR-based attendance, biometric verification, and location validation to improve classroom attendance monitoring.

---

**Developed by:** Nived Akshaya

**Project:** ERP Attendance Management System
