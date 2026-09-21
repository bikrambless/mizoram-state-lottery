# 🎯 MIZORAM STATE LOTTERY - Official Result Publishing Portal

A production-grade, official lottery result publishing web portal and integrated admin management system for **MIZORAM STATE LOTTERY**.

Built with **Node.js, Express, Vanilla ES6 JavaScript, and Vanilla CSS3** with a **Royal Sapphire & Platinum Gold** theme.

---

## 🌟 Key Features

### 1. User Portal (`/`)
- **Official Identity & Emblem**: Government of Mizoram official seal with golden crest and Directorate verification tags.
- **Live Indian Standard Time (IST) Clock**: Real-time ticking clock in the top announcement bar.
- **Dynamic Draw Countdown Timer**:
  - Automatically calculates remaining time until the next upcoming draw (**1:00 PM Day Draw** or **8:00 PM Night Draw**).
  - Status badges: `Upcoming Draw`, `🔴 Live Draw In Progress`, `Result Published`.
- **Dual Draw Slot Switcher**:
  - Instant toggle between **1:00 PM Day Draw** and **8:00 PM Night Draw**.
  - Quick date picker: **Today**, **Yesterday**, and custom calendar date selection.
- **Interactive Fullscreen Lightbox / Result Viewer**:
  - Hardware-accelerated **Zoom In / Out** (mouse wheel, buttons, or mobile pinch-to-zoom).
  - **Pan / Drag** across high-resolution sheets.
  - **Rotate (90° clockwise)** and **100% Reset**.
  - 1-click instant direct JPG download button.
  - Keyboard shortcuts (`Esc` to close, `+`/`-` to zoom, `0` to reset, `R` to rotate).
- **Historical Result Archive & Search**:
  - Filter past draw results by date, slot (Day / Night), or scheme name.
  - One-click view in Lightbox or direct JPG download.
- **Instant WhatsApp & Print Sharing**:
  - Pre-formatted WhatsApp share link with draw details and link.
  - Clean print stylesheet for direct paper printing.

### 2. Admin Management Console (`/admin`)
- **Protected Access**: JWT authentication with session timeout (default: `admin` / `mizoramadmin2026`).
- **Storage Engine Health Indicator**: Real-time indicator displaying whether connected to Supabase Cloud or operating in Local Disk Fallback.
- **Drag-and-Drop Uploader**:
  - Upload JPG, PNG, or PDF result sheets (up to 25MB).
  - Real-time animated upload progress bar via `XMLHttpRequest`.
- **Sheet Management & CRUD**:
  - View published sheets, edit metadata, replace sheet images, or delete records.

### 3. Resilient Dual-Engine Architecture
- **Supabase Cloud**: PostgreSQL database + Supabase Storage bucket (`results`).
- **Seamless Local Fallback**: When Supabase credentials are not configured or when working offline, the system automatically uses `data/results.json` and `uploads/` disk storage with zero downtime.

---

## 🚀 Quick Start (Local Machine)

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- npm

### 2. Installation
Clone or navigate to the folder:
```bash
npm install
```

### 3. Run Locally
```bash
npm start
```
Then open your browser:
- **Public Portal**: [http://localhost:5000](http://localhost:5000)
- **Admin Dashboard**: [http://localhost:5000/admin](http://localhost:5000/admin)

Default Admin Credentials:
- **Username**: `admin`
- **Password**: `mizoramadmin2026`

---

## 🌐 Deploy to GitHub, Render & Supabase

### Step 1: Create a New GitHub Repository
1. Go to [GitHub](https://github.com/new) and create a new repository (e.g. `mizoram-state-lottery`).
2. In your terminal, initialize git and push:
```bash
git init
git add .
git commit -m "Initial commit: Mizoram State Lottery portal"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mizoram-state-lottery.git
git push -u origin main
```

### Step 2: Set up Supabase
1. Create a new project on [Supabase](https://supabase.com).
2. In your Supabase Dashboard, open **SQL Editor**.
3. Copy the entire content of [`supabase-setup.sql`](./supabase-setup.sql) and click **Run**.
   - This creates the `results` table, indexes, RLS policies, and the public `results` storage bucket.
4. In Supabase Dashboard, go to **Project Settings > API**:
   - Copy **Project URL** (e.g. `https://xyzcompany.supabase.co`).
   - Copy **service_role secret** key (or `anon` key).

### Step 3: Deploy to Render
1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New + > Web Service**.
3. Connect your GitHub repository `mizoram-state-lottery`.
4. Configure service settings:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. In **Environment Variables**, add:
   - `PORT` = `5000`
   - `NODE_ENV` = `production`
   - `SUPABASE_URL` = `https://your-project.supabase.co`
   - `SUPABASE_KEY` = `your-supabase-service-role-or-anon-key`
   - `SUPABASE_BUCKET` = `results`
   - `ADMIN_USERNAME` = `admin`
   - `ADMIN_PASSWORD` = `[Choose a strong password]`
   - `ADMIN_JWT_SECRET` = `[Choose a random string]`
6. Click **Deploy Web Service**! Render will build and deploy the live portal with free SSL.

---

## ⚙️ Environment Variables Reference

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web server port | `5000` |
| `NODE_ENV` | Environment mode | `development` / `production` |
| `SUPABASE_URL` | Supabase Project API URL | Empty (local fallback) |
| `SUPABASE_KEY` | Supabase Service Role / Anon API Key | Empty (local fallback) |
| `SUPABASE_BUCKET` | Supabase Storage Bucket Name | `results` |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD` | Admin login password | `mizoramadmin2026` |
| `ADMIN_JWT_SECRET`| Secret key for signing JWT session tokens | Custom string |

---

## 📁 Project Structure

```
MIZORAM/
├── data/
│   └── results.json              # Local database file
├── uploads/                      # Local uploads directory
├── services/
│   └── storageService.js         # Supabase & local disk dual-engine adapter
├── public/
│   ├── index.html                # Public User Portal
│   ├── css/
│   │   └── style.css             # Royal Sapphire & Platinum Gold CSS
│   ├── js/
│   │   └── app.js                # Live clock, countdown, tabs, lightbox
│   ├── images/
│   │   ├── emblem.jpg            # Official Mizoram State Emblem
│   │   └── favicon.jpg           # Browser favicon
│   └── admin/
│       ├── index.html            # Admin dashboard
│       ├── admin.css             # Admin dashboard styling
│       └── admin.js              # Admin logic, XHR progress upload, CRUD
├── .env                          # Local environment variables
├── .env.example                  # Example template
├── .gitignore                    # Git ignore file
├── package.json                  # Node dependencies and scripts
├── render.yaml                   # 1-click Render blueprint
├── supabase-setup.sql            # Supabase database & storage SQL setup script
├── vercel.json                   # Vercel deployment configuration
└── README.md                     # Documentation
```

---

## ⚖️ Official Disclaimer
*Mizoram State Lottery results published on this official portal are certified true copies from the Directorate of State Lotteries, Government of Mizoram. Claim period is 30 days from draw date. Players must be 18 years or older.*
