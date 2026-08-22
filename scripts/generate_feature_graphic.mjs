import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const desktopPath = 'C:\\Users\\bdcalling\\Desktop';
const downloadsPath = 'C:\\Users\\bdcalling\\Downloads';
const artifactDir = 'C:\\Users\\bdcalling\\.gemini\\antigravity-ide\\brain\\c75892eb-f521-4b4c-a0e1-619882b7a4f4';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SNAP Life Play Store Feature Graphic</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
  }
  body {
    width: 1024px;
    height: 500px;
    background: radial-gradient(circle at 80% 20%, #1e3a5f 0%, #0c1829 60%, #080f1a 100%);
    font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
    color: #FFFFFF;
    position: relative;
    overflow: hidden;
    display: flex;
  }

  /* Decorative Glow Orbs */
  .orb-1 {
    position: absolute;
    width: 450px;
    height: 450px;
    top: -100px;
    right: -50px;
    background: radial-gradient(circle, rgba(58, 187, 212, 0.35) 0%, rgba(58, 187, 212, 0) 70%);
    filter: blur(40px);
    border-radius: 50%;
    z-index: 1;
  }
  .orb-2 {
    position: absolute;
    width: 380px;
    height: 380px;
    bottom: -100px;
    right: 250px;
    background: radial-gradient(circle, rgba(244, 117, 48, 0.25) 0%, rgba(244, 117, 48, 0) 70%);
    filter: blur(50px);
    border-radius: 50%;
    z-index: 1;
  }
  .orb-3 {
    position: absolute;
    width: 300px;
    height: 300px;
    bottom: -80px;
    left: -50px;
    background: radial-gradient(circle, rgba(43, 116, 153, 0.3) 0%, rgba(43, 116, 153, 0) 70%);
    filter: blur(40px);
    border-radius: 50%;
    z-index: 1;
  }

  /* Grid overlay for tech/modern vibe */
  .grid-pattern {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    z-index: 1;
  }

  /* Left Branding Content */
  .left-container {
    width: 580px;
    height: 100%;
    padding: 50px 0 50px 60px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    z-index: 2;
  }

  .brand-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(58, 187, 212, 0.15);
    border: 1px solid rgba(58, 187, 212, 0.4);
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    color: #3ABBD4;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    width: fit-content;
  }

  .title-group {
    margin-top: 10px;
  }
  .app-title {
    font-size: 54px;
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -1.5px;
    color: #FFFFFF;
  }
  .app-title span {
    background: linear-gradient(135deg, #3ABBD4 0%, #F47530 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .app-tagline {
    font-family: 'Inter', sans-serif;
    font-size: 18px;
    font-weight: 500;
    color: #94A3B8;
    margin-top: 12px;
    line-height: 1.4;
  }

  /* Feature Pills */
  .features-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }
  .feat-pill {
    background: rgba(255, 255, 255, 0.07);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 7px 14px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 600;
    color: #E2E8F0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .feat-pill span {
    font-size: 14px;
  }

  /* Right Visual / App Showcase Mockups */
  .right-showcase {
    position: absolute;
    right: 40px;
    top: 30px;
    width: 400px;
    height: 440px;
    z-index: 2;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* Simulated Mobile Cards stacked beautifully */
  .card-back {
    position: absolute;
    right: 0;
    top: 20px;
    width: 250px;
    height: 380px;
    background: linear-gradient(145deg, #13273e, #0e1e30);
    border: 1px solid rgba(58, 187, 212, 0.25);
    border-radius: 28px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    transform: rotate(7deg) scale(0.92);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    opacity: 0.7;
  }

  .card-front {
    position: absolute;
    left: 20px;
    top: 25px;
    width: 270px;
    height: 400px;
    background: linear-gradient(165deg, #172a3d 0%, #0d1a29 100%);
    border: 2px solid rgba(58, 187, 212, 0.5);
    border-radius: 30px;
    box-shadow: 0 25px 60px rgba(0,0,0,0.7), 0 0 30px rgba(58, 187, 212, 0.2);
    transform: rotate(-4deg);
    padding: 22px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .mock-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mock-title {
    font-size: 16px;
    font-weight: 800;
    color: #FFFFFF;
  }
  .mock-badge {
    background: rgba(244, 117, 48, 0.2);
    border: 1px solid #F47530;
    color: #F47530;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 8px;
  }

  .mock-banner {
    background: linear-gradient(135deg, #F47530, #F59E0B);
    padding: 14px;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mock-banner-title {
    font-size: 13px;
    font-weight: 800;
    color: #FFFFFF;
  }
  .mock-banner-sub {
    font-size: 11px;
    color: rgba(255,255,255,0.9);
    font-weight: 500;
  }

  .mock-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mock-item {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    padding: 10px 14px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mock-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: #3ABBD4;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .mock-text {
    font-size: 12px;
    font-weight: 700;
    color: #F1F5F9;
  }
  .mock-sub {
    font-size: 10px;
    color: #94A3B8;
    font-weight: 500;
  }

  .mock-btn {
    background: linear-gradient(135deg, #3ABBD4, #2B7499);
    color: #FFFFFF;
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    padding: 10px;
    border-radius: 12px;
    box-shadow: 0 4px 15px rgba(58, 187, 212, 0.35);
  }
</style>
</head>
<body>

  <div class="grid-pattern"></div>
  <div class="orb-1"></div>
  <div class="orb-2"></div>
  <div class="orb-3"></div>

  <!-- Left Content -->
  <div class="left-container">
    <div>
      <div class="brand-badge">🦴 #1 Bone Health App</div>
      <div class="title-group">
        <h1 class="app-title">SNAP <span>Life</span></h1>
        <p class="app-tagline">Bone health, targeted movement & longevity for healthy ageing.</p>
      </div>
    </div>

    <div class="features-row">
      <div class="feat-pill"><span>🦴</span> Bone Vitality Tracker</div>
      <div class="feat-pill"><span>🏋️</span> Bone-Safe Movement</div>
      <div class="feat-pill"><span>🥗</span> Nutrition & Calcium</div>
      <div class="feat-pill"><span>🧘</span> Breathing Studio</div>
      <div class="feat-pill"><span>🤖</span> Bone Buddy AI</div>
      <div class="feat-pill"><span>🤝</span> 1-on-1 Coaching</div>
    </div>
  </div>

  <!-- Right Visual Mockup -->
  <div class="right-showcase">
    <!-- Back Card (Breathing Studio / Meditation) -->
    <div class="card-back">
      <div style="font-size: 14px; font-weight: 800; color: #3ABBD4;">🧘 Breathing Studio</div>
      <div style="background: rgba(58,187,212,0.15); border-radius: 14px; padding: 12px; font-size: 12px; color: #CBD5E1;">
        Regulate nervous system & reduce cortisol
      </div>
      <div style="background: rgba(255,255,255,0.05); border-radius: 14px; padding: 12px; font-size: 12px; color: #CBD5E1;">
        🎧 Meditation Lounge
      </div>
      <div style="margin-top: auto; background: #3ABBD4; color: #fff; font-size: 12px; font-weight: 700; text-align: center; padding: 8px; border-radius: 10px;">
        Start Calm Session
      </div>
    </div>

    <!-- Front Card (Home / Today's Focus) -->
    <div class="card-front">
      <div class="mock-header">
        <div class="mock-title">Today's Focus</div>
        <div class="mock-badge">Active</div>
      </div>

      <div class="mock-banner">
        <div class="mock-banner-title">Build Stronger Bones</div>
        <div class="mock-banner-sub">Daily personalized movement & habits</div>
      </div>

      <div class="mock-list">
        <div class="mock-item">
          <div class="mock-icon" style="background: #F47530;">🥗</div>
          <div>
            <div class="mock-text">Nutrition & Calcium</div>
            <div class="mock-sub">Bone-essential foods</div>
          </div>
        </div>
        <div class="mock-item">
          <div class="mock-icon" style="background: #3ABBD4;">🏋️</div>
          <div>
            <div class="mock-text">Impact & Balance</div>
            <div class="mock-sub">Safe 10-min routine</div>
          </div>
        </div>
      </div>

      <div class="mock-btn">Start Today's Routine →</div>
    </div>
  </div>

</body>
</html>`;

const tempHtml = path.resolve('temp_feature_graphic.html');
fs.writeFileSync(tempHtml, html, 'utf-8');

const targetPath = path.resolve('SNAP_Life_Google_Play_Feature_Graphic_1024x500.png');

console.log('Rendering 1024x500 Feature Graphic...');
execSync(`"${edgePath}" --headless --disable-gpu --force-device-scale-factor=1 --window-size=1024,500 --screenshot="${targetPath}" "file://${tempHtml}"`);

try { fs.unlinkSync(tempHtml); } catch {}

// Copy to Desktop, Downloads, Artifact Directory
fs.copyFileSync(targetPath, path.join(desktopPath, 'SNAP_Life_Feature_Graphic_1024x500.png'));
fs.copyFileSync(targetPath, path.join(downloadsPath, 'SNAP_Life_Feature_Graphic_1024x500.png'));
fs.copyFileSync(targetPath, path.join(artifactDir, 'SNAP_Life_Feature_Graphic_1024x500.png'));

console.log('Feature graphic generated successfully!');
console.log('Desktop: ', path.join(desktopPath, 'SNAP_Life_Feature_Graphic_1024x500.png'));
