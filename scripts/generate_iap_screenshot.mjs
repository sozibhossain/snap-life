import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const desktopPath = 'C:\\Users\\bdcalling\\Desktop';
const downloadsPath = 'C:\\Users\\bdcalling\\Downloads';
const artifactDir = 'C:\\Users\\bdcalling\\.gemini\\antigravity-ide\\brain\\c75892eb-f521-4b4c-a0e1-619882b7a4f4';

// 1. ALL 3 SESSIONS TOGETHER (compact, perfectly fitted for 1284x2778)
const all3Html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>All 3 Coaching Sessions</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
  body {
    width: 1284px;
    height: 2778px;
    background-color: #F8FAFC;
    font-family: 'Inter', -apple-system, sans-serif;
    color: #1E293B;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .status-bar {
    height: 110px;
    background: linear-gradient(135deg, #F47530 0%, #F59E0B 100%);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 70px 0 70px;
    color: #FFFFFF;
    font-size: 38px;
    font-weight: 700;
  }
  .status-icons { display: flex; gap: 18px; align-items: center; }
  .status-icons svg { fill: #FFFFFF; }
  .header {
    background: linear-gradient(135deg, #F47530 0%, #F59E0B 100%);
    padding: 20px 60px 36px 60px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 70px;
    font-weight: 800;
    color: #FFFFFF;
  }
  .pts-badge {
    background: rgba(255, 255, 255, 0.25);
    border: 2px solid rgba(255, 255, 255, 0.4);
    padding: 12px 32px;
    border-radius: 40px;
    color: #FFFFFF;
    font-size: 32px;
    font-weight: 700;
  }
  .tabs-container {
    background: #FFFFFF;
    border-bottom: 2px solid #E2E8F0;
    display: flex;
    justify-content: space-around;
    padding: 0 40px;
  }
  .tab-item {
    font-size: 34px;
    font-weight: 600;
    color: #64748B;
    padding: 28px 20px;
    position: relative;
  }
  .tab-item.active { color: #0EA5E9; font-weight: 700; }
  .tab-item.active::after {
    content: '';
    position: absolute;
    bottom: 0; left: 10px; right: 10px; height: 6px;
    background: #0EA5E9;
    border-radius: 6px 6px 0 0;
  }
  .content {
    flex: 1;
    padding: 28px 45px;
    display: flex;
    flex-direction: column;
    gap: 26px;
    justify-content: space-evenly;
  }
  .session-card {
    background: #FFFFFF;
    border-radius: 32px;
    padding: 34px 44px;
    border: 2px solid #E2E8F0;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.04);
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .card-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 46px;
    font-weight: 800;
    color: #0F172A;
  }
  .price-pill {
    font-size: 38px;
    font-weight: 800;
    padding: 10px 30px;
    border-radius: 20px;
  }
  .pill-orange { background: #FFEDD5; color: #EA580C; }
  .pill-purple { background: #F3E8FF; color: #9333EA; }
  .pill-red { background: #FEE2E2; color: #DC2626; }
  .card-duration {
    font-size: 30px;
    color: #64748B;
    font-weight: 500;
    margin-bottom: 20px;
  }
  .bullet-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 26px;
  }
  .bullet-item {
    font-size: 30px;
    color: #475569;
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-orange { background-color: #F47530; }
  .dot-purple { background-color: #9C59B5; }
  .dot-red { background-color: #C0392B; }
  .btn {
    color: #FFFFFF;
    font-size: 34px;
    font-weight: 700;
    text-align: center;
    padding: 26px;
    border-radius: 24px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 14px;
  }
  .btn-orange { background: #F47530; box-shadow: 0 6px 18px rgba(244, 117, 48, 0.25); }
  .btn-purple { background: #9C59B5; box-shadow: 0 6px 18px rgba(156, 89, 181, 0.25); }
  .btn-red { background: #C0392B; box-shadow: 0 6px 18px rgba(192, 57, 43, 0.25); }
  .bottom-nav {
    height: 180px;
    background: #FFFFFF;
    border-top: 2px solid #E2E8F0;
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 0 30px 30px 30px;
  }
  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #94A3B8;
    font-size: 24px;
    font-weight: 600;
    position: relative;
  }
  .nav-item.active { color: #3ABBD4; }
  .nav-icon { font-size: 42px; }
  .bone-badge {
    position: absolute;
    top: -2px; right: 18px;
    width: 16px; height: 16px;
    background: #3ABBD4;
    border-radius: 50%;
    border: 3px solid #FFFFFF;
  }
</style>
</head>
<body>
  <div class="status-bar">
    <span>9:42</span>
    <div class="status-icons">
      <svg width="34" height="24" viewBox="0 0 17 12"><path d="M1 10h2V2H1v8zm4 0h2V4H5v6zm4 0h2V7H9v3zm4 0h2V0h-2v10z"/></svg>
      <svg width="34" height="26" viewBox="0 0 24 18"><path d="M12 4C7.3 4 3.08 5.8 0 8.74l1.77 1.77C4.38 7.9 8 6.5 12 6.5s7.62 1.4 10.23 4.01L24 8.74C20.92 5.8 16.7 4 12 4zm0 6c-3.14 0-6 1.22-8.13 3.23L5.64 15c1.7-1.6 3.97-2.5 6.36-2.5s4.66.9 6.36 2.5l1.77-1.77C18 11.22 15.14 10 12 10zm0 6c-1.38 0-2.5 1.12-2.5 2.5S10.62 21 12 21s2.5-1.12 2.5-2.5S13.38 16 12 16z"/></svg>
      <svg width="44" height="24" viewBox="0 0 24 12"><rect x="1" y="1" width="19" height="10" rx="3" fill="none" stroke="#FFFFFF" stroke-width="2"/><rect x="3" y="3" width="12" height="6" rx="1.5"/><path d="M22 4v4" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
  </div>
  <div class="header">
    <div class="header-title">Community</div>
    <div class="pts-badge">★ 0 pts</div>
  </div>
  <div class="tabs-container">
    <div class="tab-item">Leaderboard</div>
    <div class="tab-item">Progress</div>
    <div class="tab-item active">Coaching</div>
    <div class="tab-item">Experts</div>
  </div>
  <div class="content">
    <!-- 1. Focus Session -->
    <div class="session-card" style="border: 3px solid #FDBA74;">
      <div class="card-top">
        <div class="card-title">Focus Session</div>
        <div class="price-pill pill-orange">£65</div>
      </div>
      <div class="card-duration">45 minutes</div>
      <ul class="bullet-list">
        <li class="bullet-item"><span class="dot dot-orange"></span> Focused support and accountability</li>
        <li class="bullet-item"><span class="dot dot-orange"></span> Confidence and mindset</li>
        <li class="bullet-item"><span class="dot dot-orange"></span> Wellbeing support</li>
      </ul>
      <div class="btn btn-orange">📅 Book This Session</div>
    </div>

    <!-- 2. Deep Support Session -->
    <div class="session-card" style="border: 3px solid #D8B4FE;">
      <div class="card-top">
        <div class="card-title">Deep Support Session</div>
        <div class="price-pill pill-purple">£85</div>
      </div>
      <div class="card-duration">60 minutes</div>
      <ul class="bullet-list">
        <li class="bullet-item"><span class="dot dot-purple"></span> Deeper reflection</li>
        <li class="bullet-item"><span class="dot dot-purple"></span> Healthy ageing transitions</li>
        <li class="bullet-item"><span class="dot dot-purple"></span> Stress and emotional wellbeing</li>
      </ul>
      <div class="btn btn-purple">📅 Book This Session</div>
    </div>

    <!-- 3. Transformation Session -->
    <div class="session-card" style="border: 3px solid #FCA5A5;">
      <div class="card-top">
        <div class="card-title">Transformation Session</div>
        <div class="price-pill pill-red">£125</div>
      </div>
      <div class="card-duration">90 minutes</div>
      <ul class="bullet-list">
        <li class="bullet-item"><span class="dot dot-red"></span> Deeper life transitions</li>
        <li class="bullet-item"><span class="dot dot-red"></span> Diagnosis adjustment and menopause support</li>
        <li class="bullet-item"><span class="dot dot-red"></span> Identity, confidence, and transformational conversations</li>
      </ul>
      <div class="btn btn-red">📅 Book This Session</div>
    </div>
  </div>

  <div class="bottom-nav">
    <div class="nav-item"><div class="nav-icon">🏠</div><span>Home</span></div>
    <div class="nav-item"><div class="nav-icon">📈</div><span>Health</span></div>
    <div class="nav-item"><div class="bone-badge"></div><div class="nav-icon">💬</div><span>Bone Buddy</span></div>
    <div class="nav-item active"><div class="nav-icon">🤍</div><span>Wellness</span></div>
    <div class="nav-item"><div class="nav-icon">📖</div><span>Learn</span></div>
  </div>
</body>
</html>`;

// 2. Individual Transformation Session Focused Screen (Scrolled down)
const transformHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Transformation Session</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
  body {
    width: 1284px;
    height: 2778px;
    background-color: #F8FAFC;
    font-family: 'Inter', -apple-system, sans-serif;
    color: #1E293B;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .status-bar {
    height: 120px;
    background: linear-gradient(135deg, #F47530 0%, #F59E0B 100%);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 70px 0 70px;
    color: #FFFFFF;
    font-size: 38px;
    font-weight: 700;
  }
  .status-icons { display: flex; gap: 18px; align-items: center; }
  .status-icons svg { fill: #FFFFFF; }
  .header {
    background: linear-gradient(135deg, #F47530 0%, #F59E0B 100%);
    padding: 30px 60px 45px 60px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 76px;
    font-weight: 800;
    color: #FFFFFF;
  }
  .pts-badge {
    background: rgba(255, 255, 255, 0.25);
    border: 2px solid rgba(255, 255, 255, 0.4);
    padding: 16px 36px;
    border-radius: 40px;
    color: #FFFFFF;
    font-size: 34px;
    font-weight: 700;
  }
  .tabs-container {
    background: #FFFFFF;
    border-bottom: 2px solid #E2E8F0;
    display: flex;
    justify-content: space-around;
    padding: 0 40px;
  }
  .tab-item {
    font-size: 36px;
    font-weight: 600;
    color: #64748B;
    padding: 36px 20px;
    position: relative;
  }
  .tab-item.active { color: #0EA5E9; font-weight: 700; }
  .tab-item.active::after {
    content: '';
    position: absolute;
    bottom: 0; left: 10px; right: 10px; height: 6px;
    background: #0EA5E9;
    border-radius: 6px 6px 0 0;
  }
  .content {
    flex: 1;
    padding: 40px 50px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  .session-card {
    background: #FFFFFF;
    border-radius: 36px;
    padding: 46px 48px;
    border: 3px solid #FCA5A5;
    box-shadow: 0 12px 36px rgba(192, 57, 43, 0.08);
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }
  .card-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 50px;
    font-weight: 800;
    color: #0F172A;
  }
  .price-pill-red {
    background: #FEE2E2;
    color: #DC2626;
    font-size: 42px;
    font-weight: 800;
    padding: 12px 34px;
    border-radius: 24px;
  }
  .card-duration {
    font-size: 34px;
    color: #64748B;
    font-weight: 500;
    margin-bottom: 32px;
  }
  .bullet-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 36px;
  }
  .bullet-item {
    font-size: 36px;
    color: #475569;
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .dot-red { width: 14px; height: 14px; border-radius: 50%; background-color: #C0392B; }
  .btn-red {
    background: #C0392B;
    color: #FFFFFF;
    font-size: 38px;
    font-weight: 700;
    text-align: center;
    padding: 34px;
    border-radius: 28px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    box-shadow: 0 8px 24px rgba(192, 57, 43, 0.25);
  }
  .bottom-nav {
    height: 200px;
    background: #FFFFFF;
    border-top: 2px solid #E2E8F0;
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 0 30px 40px 30px;
  }
  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: #94A3B8;
    font-size: 26px;
    font-weight: 600;
  }
  .nav-item.active { color: #3ABBD4; }
  .nav-icon { font-size: 46px; }
</style>
</head>
<body>
  <div class="status-bar">
    <span>9:42</span>
    <div class="status-icons">
      <svg width="34" height="24" viewBox="0 0 17 12"><path d="M1 10h2V2H1v8zm4 0h2V4H5v6zm4 0h2V7H9v3zm4 0h2V0h-2v10z"/></svg>
      <svg width="34" height="26" viewBox="0 0 24 18"><path d="M12 4C7.3 4 3.08 5.8 0 8.74l1.77 1.77C4.38 7.9 8 6.5 12 6.5s7.62 1.4 10.23 4.01L24 8.74C20.92 5.8 16.7 4 12 4zm0 6c-3.14 0-6 1.22-8.13 3.23L5.64 15c1.7-1.6 3.97-2.5 6.36-2.5s4.66.9 6.36 2.5l1.77-1.77C18 11.22 15.14 10 12 10zm0 6c-1.38 0-2.5 1.12-2.5 2.5S10.62 21 12 21s2.5-1.12 2.5-2.5S13.38 16 12 16z"/></svg>
      <svg width="44" height="24" viewBox="0 0 24 12"><rect x="1" y="1" width="19" height="10" rx="3" fill="none" stroke="#FFFFFF" stroke-width="2"/><rect x="3" y="3" width="12" height="6" rx="1.5"/><path d="M22 4v4" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
  </div>
  <div class="header">
    <div class="header-title">Community</div>
    <div class="pts-badge">★ 0 pts</div>
  </div>
  <div class="tabs-container">
    <div class="tab-item">Leaderboard</div>
    <div class="tab-item">Progress</div>
    <div class="tab-item active">Coaching</div>
    <div class="tab-item">Experts</div>
  </div>
  <div class="content">
    <div class="session-card">
      <div class="card-top">
        <div class="card-title">Transformation Session</div>
        <div class="price-pill-red">£125</div>
      </div>
      <div class="card-duration">90 minutes</div>
      <ul class="bullet-list">
        <li class="bullet-item"><span class="dot-red"></span> Deeper life transitions</li>
        <li class="bullet-item"><span class="dot-red"></span> Diagnosis adjustment and menopause support</li>
        <li class="bullet-item"><span class="dot-red"></span> Identity, confidence, and transformational conversations</li>
      </ul>
      <div class="btn-red">📅 Book This Session</div>
    </div>
  </div>
  <div class="bottom-nav">
    <div class="nav-item"><div class="nav-icon">🏠</div><span>Home</span></div>
    <div class="nav-item"><div class="nav-icon">📈</div><span>Health</span></div>
    <div class="nav-item"><div class="nav-icon">💬</div><span>Bone Buddy</span></div>
    <div class="nav-item active"><div class="nav-icon">🤍</div><span>Wellness</span></div>
    <div class="nav-item"><div class="nav-icon">📖</div><span>Learn</span></div>
  </div>
</body>
</html>`;

// 3. Individual Deep Support Session Screen
const deepHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Deep Support Session</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
  body {
    width: 1284px;
    height: 2778px;
    background-color: #F8FAFC;
    font-family: 'Inter', -apple-system, sans-serif;
    color: #1E293B;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .status-bar {
    height: 120px;
    background: linear-gradient(135deg, #F47530 0%, #F59E0B 100%);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 70px 0 70px;
    color: #FFFFFF;
    font-size: 38px;
    font-weight: 700;
  }
  .status-icons { display: flex; gap: 18px; align-items: center; }
  .status-icons svg { fill: #FFFFFF; }
  .header {
    background: linear-gradient(135deg, #F47530 0%, #F59E0B 100%);
    padding: 30px 60px 45px 60px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 76px;
    font-weight: 800;
    color: #FFFFFF;
  }
  .pts-badge {
    background: rgba(255, 255, 255, 0.25);
    border: 2px solid rgba(255, 255, 255, 0.4);
    padding: 16px 36px;
    border-radius: 40px;
    color: #FFFFFF;
    font-size: 34px;
    font-weight: 700;
  }
  .tabs-container {
    background: #FFFFFF;
    border-bottom: 2px solid #E2E8F0;
    display: flex;
    justify-content: space-around;
    padding: 0 40px;
  }
  .tab-item {
    font-size: 36px;
    font-weight: 600;
    color: #64748B;
    padding: 36px 20px;
    position: relative;
  }
  .tab-item.active { color: #0EA5E9; font-weight: 700; }
  .tab-item.active::after {
    content: '';
    position: absolute;
    bottom: 0; left: 10px; right: 10px; height: 6px;
    background: #0EA5E9;
    border-radius: 6px 6px 0 0;
  }
  .content {
    flex: 1;
    padding: 40px 50px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  .session-card {
    background: #FFFFFF;
    border-radius: 36px;
    padding: 46px 48px;
    border: 3px solid #D8B4FE;
    box-shadow: 0 12px 36px rgba(156, 89, 181, 0.08);
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }
  .card-title {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 50px;
    font-weight: 800;
    color: #0F172A;
  }
  .price-pill-purple {
    background: #F3E8FF;
    color: #9333EA;
    font-size: 42px;
    font-weight: 800;
    padding: 12px 34px;
    border-radius: 24px;
  }
  .card-duration {
    font-size: 34px;
    color: #64748B;
    font-weight: 500;
    margin-bottom: 32px;
  }
  .bullet-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 36px;
  }
  .bullet-item {
    font-size: 36px;
    color: #475569;
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .dot-purple { width: 14px; height: 14px; border-radius: 50%; background-color: #9C59B5; }
  .btn-purple {
    background: #9C59B5;
    color: #FFFFFF;
    font-size: 38px;
    font-weight: 700;
    text-align: center;
    padding: 34px;
    border-radius: 28px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    box-shadow: 0 8px 24px rgba(156, 89, 181, 0.25);
  }
  .bottom-nav {
    height: 200px;
    background: #FFFFFF;
    border-top: 2px solid #E2E8F0;
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 0 30px 40px 30px;
  }
  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: #94A3B8;
    font-size: 26px;
    font-weight: 600;
  }
  .nav-item.active { color: #3ABBD4; }
  .nav-icon { font-size: 46px; }
</style>
</head>
<body>
  <div class="status-bar">
    <span>9:42</span>
    <div class="status-icons">
      <svg width="34" height="24" viewBox="0 0 17 12"><path d="M1 10h2V2H1v8zm4 0h2V4H5v6zm4 0h2V7H9v3zm4 0h2V0h-2v10z"/></svg>
      <svg width="34" height="26" viewBox="0 0 24 18"><path d="M12 4C7.3 4 3.08 5.8 0 8.74l1.77 1.77C4.38 7.9 8 6.5 12 6.5s7.62 1.4 10.23 4.01L24 8.74C20.92 5.8 16.7 4 12 4zm0 6c-3.14 0-6 1.22-8.13 3.23L5.64 15c1.7-1.6 3.97-2.5 6.36-2.5s4.66.9 6.36 2.5l1.77-1.77C18 11.22 15.14 10 12 10zm0 6c-1.38 0-2.5 1.12-2.5 2.5S10.62 21 12 21s2.5-1.12 2.5-2.5S13.38 16 12 16z"/></svg>
      <svg width="44" height="24" viewBox="0 0 24 12"><rect x="1" y="1" width="19" height="10" rx="3" fill="none" stroke="#FFFFFF" stroke-width="2"/><rect x="3" y="3" width="12" height="6" rx="1.5"/><path d="M22 4v4" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
  </div>
  <div class="header">
    <div class="header-title">Community</div>
    <div class="pts-badge">★ 0 pts</div>
  </div>
  <div class="tabs-container">
    <div class="tab-item">Leaderboard</div>
    <div class="tab-item">Progress</div>
    <div class="tab-item active">Coaching</div>
    <div class="tab-item">Experts</div>
  </div>
  <div class="content">
    <div class="session-card">
      <div class="card-top">
        <div class="card-title">Deep Support Session</div>
        <div class="price-pill-purple">£85</div>
      </div>
      <div class="card-duration">60 minutes</div>
      <ul class="bullet-list">
        <li class="bullet-item"><span class="dot-purple"></span> Deeper reflection</li>
        <li class="bullet-item"><span class="dot-purple"></span> Healthy ageing transitions</li>
        <li class="bullet-item"><span class="dot-purple"></span> Stress and emotional wellbeing</li>
      </ul>
      <div class="btn-purple">📅 Book This Session</div>
    </div>
  </div>
  <div class="bottom-nav">
    <div class="nav-item"><div class="nav-icon">🏠</div><span>Home</span></div>
    <div class="nav-item"><div class="nav-icon">📈</div><span>Health</span></div>
    <div class="nav-item"><div class="nav-icon">💬</div><span>Bone Buddy</span></div>
    <div class="nav-item active"><div class="nav-icon">🤍</div><span>Wellness</span></div>
    <div class="nav-item"><div class="nav-icon">📖</div><span>Learn</span></div>
  </div>
</body>
</html>`;

function renderAndSave(html, fileName) {
  const tmp = path.resolve(`temp_${fileName}.html`);
  fs.writeFileSync(tmp, html, 'utf-8');
  const localTarget = path.resolve(fileName);
  execSync(`"${edgePath}" --headless --disable-gpu --force-device-scale-factor=1 --window-size=1284,2778 --screenshot="${localTarget}" "file://${tmp}"`);
  try { fs.unlinkSync(tmp); } catch {}

  // Copy to Desktop, Downloads, ArtifactDir
  fs.copyFileSync(localTarget, path.join(desktopPath, fileName));
  fs.copyFileSync(localTarget, path.join(downloadsPath, fileName));
  fs.copyFileSync(localTarget, path.join(artifactDir, fileName));
  console.log(`Rendered and distributed: ${fileName}`);
}

console.log('Generating all screenshots...');
renderAndSave(all3Html, 'All_3_Coaching_Sessions_Screenshot.png');
renderAndSave(deepHtml, 'Deep_Support_Session_Screenshot.png');
renderAndSave(transformHtml, 'Transformation_Session_Screenshot.png');
console.log('All screenshots ready!');
