import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STORE_DIR = path.resolve(ROOT_DIR, 'store-assets');
const TEMP_DIR = path.resolve(STORE_DIR, 'temp-render');

// Ensure directories exist
fs.mkdirSync(STORE_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Copy icon128.png to store-assets
const iconSrc = path.resolve(ROOT_DIR, 'src/icons/icon128.png');
const iconDest = path.resolve(STORE_DIR, 'icon-128.png');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, iconDest);
  console.log('✓ Copied store icon (128x128):', iconDest);
}

// Convert icons to base64 for embedding in standalone HTML templates
function getBase64(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1);
  return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${buffer.toString('base64')}`;
}

const icon128Base64 = getBase64(path.resolve(ROOT_DIR, 'src/icons/icon128.png'));
const thruCoinBase64 = getBase64(path.resolve(ROOT_DIR, 'src/icons/thru.png'));

// Chrome executable path
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function renderHtmlToImage(htmlContent, outputPath, width, height) {
  const tempHtmlPath = path.resolve(TEMP_DIR, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

  try {
    execFileSync(CHROME_PATH, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--screenshot=${outputPath}`,
      `file://${tempHtmlPath}`,
    ], { timeout: 30000 });

    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`✓ Rendered: ${path.basename(outputPath)} (${width}x${height}, ${(stats.size / 1024).toFixed(1)} KB)`);
    } else {
      console.error(`✗ Failed to generate: ${outputPath}`);
    }
  } catch (err) {
    console.error(`✗ Error rendering ${outputPath}:`, err.message);
  } finally {
    try { fs.unlinkSync(tempHtmlPath); } catch {}
  }
}

// Shared CSS styles for the screenshots
const SHARED_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #090c10;
    color: #e6edf3;
    width: 1280px;
    height: 800px;
    overflow: hidden;
    display: flex;
    position: relative;
  }
  .bg-glow-1 {
    position: absolute;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, rgba(14, 165, 233, 0) 70%);
    top: -150px;
    left: -100px;
    pointer-events: none;
  }
  .bg-glow-2 {
    position: absolute;
    width: 700px;
    height: 700px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, rgba(99, 102, 241, 0) 70%);
    bottom: -200px;
    right: -100px;
    pointer-events: none;
  }
  .container {
    width: 1280px;
    height: 800px;
    display: flex;
    padding: 40px 60px;
    gap: 50px;
    align-items: center;
    position: relative;
    z-index: 1;
  }
  .left-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 20px;
  }
  .brand-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 20px;
    background: rgba(14, 165, 233, 0.12);
    border: 1px solid rgba(14, 165, 233, 0.3);
    color: #38bdf8;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    width: fit-content;
  }
  .brand-badge img {
    width: 18px;
    height: 18px;
  }
  .headline {
    font-size: 38px;
    font-weight: 800;
    line-height: 1.2;
    color: #ffffff;
    letter-spacing: -0.02em;
  }
  .headline .highlight {
    background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subhead {
    font-size: 17px;
    line-height: 1.6;
    color: #94a3b8;
    max-width: 500px;
  }
  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 10px;
  }
  .feature-item {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 15px;
    color: #cbd5e1;
    font-weight: 500;
  }
  .feature-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #38bdf8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .wallet-frame {
    width: 408px;
    height: 600px;
    border-radius: 20px;
    background: #0f172a;
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(14, 165, 233, 0.15);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
  }
  /* Top mock title bar */
  .popup-top-bar {
    height: 38px;
    background: #090e1a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    font-size: 12px;
    color: #64748b;
  }
  .popup-top-bar .dots {
    display: flex;
    gap: 6px;
  }
  .popup-top-bar .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dot-red { background: #ef4444; }
  .dot-yellow { background: #f59e0b; }
  .dot-green { background: #10b981; }
  .network-pill {
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
    font-size: 11px;
    font-weight: 600;
  }

  /* Wallet header / balance hero */
  .dash-head {
    background: #0b1120;
    padding: 24px 20px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .account-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
  }
  .account-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 4px 10px;
    border-radius: 14px;
    font-size: 12px;
    font-weight: 600;
    color: #f1f5f9;
  }
  .avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: linear-gradient(135deg, #0284c7, #38bdf8);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: white;
  }
  .balance-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .balance-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .usd-val {
    font-size: 32px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.02em;
  }
  .refresh-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
  }
  .native-val {
    font-size: 13px;
    color: #38bdf8;
    font-weight: 600;
  }
  .assets-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 6px;
    font-size: 11px;
    color: #64748b;
  }
  .assets-link {
    color: #94a3b8;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Action Grid */
  .action-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    padding: 20px;
    background: #0f172a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .action-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: #f1f5f9;
    font-size: 12px;
    font-weight: 600;
  }
  .action-icon {
    font-size: 18px;
    color: #38bdf8;
  }

  /* List area */
  .section-head {
    padding: 14px 20px 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .token-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .token-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .token-logo {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #1e293b;
    border: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .token-logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .token-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .token-symbol {
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
  }
  .token-name {
    font-size: 11px;
    color: #64748b;
  }
  .token-bal {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .bal-amt {
    font-size: 13px;
    font-weight: 700;
    color: #ffffff;
  }
  .bal-usd {
    font-size: 11px;
    color: #64748b;
  }
`;

// 1. Screenshot 1: Dashboard
function generateScreenshot1() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      ${SHARED_CSS}
    </style>
  </head>
  <body>
    <div class="bg-glow-1"></div>
    <div class="bg-glow-2"></div>
    <div class="container">
      <div class="left-pane">
        <div class="brand-badge">
          <img src="${icon128Base64}" alt="Thru" />
          <span>Thru L1 Network</span>
        </div>
        <h1 class="headline">Fast, High-Performance <span class="highlight">Thru L1 Wallet</span></h1>
        <p class="subhead">A clean, ultra-responsive Chrome self-custody wallet designed specifically for the high-throughput Thru blockchain.</p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">⚡</div>
            <span>USD-first portfolio balance with real-time THRU rate</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔄</div>
            <span>Rabby-style instant sync & background auto-refresh</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🎯</div>
            <span>One-click actions: Send, Receive, Mint, Faucet, & History</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🛡️</div>
            <span>Institutional-grade PBKDF2 600K AES-256-GCM encryption</span>
          </div>
        </div>
      </div>

      <div class="wallet-frame">
        <div class="popup-top-bar">
          <div class="dots">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
          </div>
          <span>Thru Wallet</span>
          <div class="network-pill">Betanet</div>
        </div>

        <div class="dash-head">
          <div class="account-row">
            <div class="account-pill">
              <div class="avatar">A1</div>
              <span>Account 1</span>
              <span style="color:#64748b; font-size:11px;">ta1z...89d</span>
            </div>
            <span style="color:#64748b; font-size:18px;">⚙️</span>
          </div>

          <div class="balance-card">
            <div class="balance-row">
              <span class="usd-val">$1,245.80</span>
              <div class="refresh-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/>
                </svg>
              </div>
            </div>
            <div class="native-val">12,458.000000 THRU</div>
            <div class="assets-foot">
              <span>THRU · LAB</span>
              <div class="assets-link">Assets ›</div>
            </div>
          </div>
        </div>

        <div class="action-grid">
          <div class="action-tile">
            <span class="action-icon">↗</span>
            <span>Send</span>
          </div>
          <div class="action-tile">
            <span class="action-icon">↙</span>
            <span>Receive</span>
          </div>
          <div class="action-tile">
            <span class="action-icon">⇄</span>
            <span>Swap</span>
          </div>
          <div class="action-tile">
            <span class="action-icon">🕒</span>
            <span>History</span>
          </div>
          <div class="action-tile">
            <span class="action-icon">🛡️</span>
            <span>Security</span>
          </div>
          <div class="action-tile">
            <span class="action-icon">✦</span>
            <span>Faucet</span>
          </div>
        </div>

        <div class="section-head">
          <span>Assets</span>
          <span style="color:#38bdf8; font-size:11px;">View all</span>
        </div>

        <div class="token-item">
          <div class="token-info">
            <div class="token-logo">
              <img src="${thruCoinBase64}" alt="THRU" />
            </div>
            <div class="token-meta">
              <span class="token-symbol">THRU</span>
              <span class="token-name">Thru Native Token</span>
            </div>
          </div>
          <div class="token-bal">
            <span class="bal-amt">12,458.00</span>
            <span class="bal-usd">$1,245.80</span>
          </div>
        </div>

        <div class="token-item">
          <div class="token-info">
            <div class="token-logo" style="background:#0284c7; color:white; font-weight:700; font-size:11px;">
              LAB
            </div>
            <div class="token-meta">
              <span class="token-symbol">LAB</span>
              <span class="token-name">Thru Labs Token</span>
            </div>
          </div>
          <div class="token-bal">
            <span class="bal-amt">500.00</span>
            <span class="bal-usd">$50.00</span>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  renderHtmlToImage(html, path.resolve(STORE_DIR, 'screenshot-1-dashboard.png'), 1280, 800);
}

// 2. Screenshot 2: Token Drawer
function generateScreenshot2() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      ${SHARED_CSS}
      .drawer-sheet {
        position: absolute;
        top: 38px;
        left: 0;
        right: 0;
        bottom: 0;
        background: #0f172a;
        display: flex;
        flex-direction: column;
        z-index: 10;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }
      .drawer-header {
        padding: 16px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .drawer-title {
        font-size: 16px;
        font-weight: 700;
        color: #ffffff;
      }
      .drawer-search {
        margin: 14px 20px;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        color: #94a3b8;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .add-btn {
        margin: 16px 20px;
        padding: 12px;
        border-radius: 12px;
        background: linear-gradient(135deg, #0284c7, #0ea5e9);
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
    </style>
  </head>
  <body>
    <div class="bg-glow-1"></div>
    <div class="bg-glow-2"></div>
    <div class="container">
      <div class="left-pane">
        <div class="brand-badge">
          <span>Asset Management</span>
        </div>
        <h1 class="headline">Multi-Token Drawer & <span class="highlight">Verified Imports</span></h1>
        <p class="subhead">Seamlessly inspect all your assets in one sliding drawer. Search by name or symbol, and import custom tokens verified directly against Thru on-chain mints.</p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">🔍</div>
            <span>Instant search by token ticker, name, or mint address</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">📜</div>
            <span>On-chain mint verification with authentic decimals</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🏷️</div>
            <span>Real tokens only — no sample or placeholder balances</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">💎</div>
            <span>Native token avatars with network badges</span>
          </div>
        </div>
      </div>

      <div class="wallet-frame">
        <div class="popup-top-bar">
          <div class="dots">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
          </div>
          <span>Thru Wallet — Tokens</span>
          <div class="network-pill">Betanet</div>
        </div>

        <div class="drawer-sheet">
          <div class="drawer-header">
            <span class="drawer-title">Assets & Tokens</span>
            <span style="color:#94a3b8; font-size:18px;">✕</span>
          </div>

          <div class="drawer-search">
            <span>🔍</span>
            <span>Symbol, name, or mint address</span>
          </div>

          <div style="flex:1; overflow-y:auto;">
            <div class="token-item">
              <div class="token-info">
                <div class="token-logo">
                  <img src="${thruCoinBase64}" alt="THRU" />
                </div>
                <div class="token-meta">
                  <span class="token-symbol">THRU</span>
                  <span class="token-name">Thru Native Token</span>
                </div>
              </div>
              <div class="token-bal">
                <span class="bal-amt">12,458.00</span>
                <span class="bal-usd">$1,245.80</span>
              </div>
            </div>

            <div class="token-item">
              <div class="token-info">
                <div class="token-logo" style="background:#0284c7; color:white; font-weight:700; font-size:11px;">
                  LAB
                </div>
                <div class="token-meta">
                  <span class="token-symbol">LAB</span>
                  <span class="token-name">Thru Labs Token</span>
                </div>
              </div>
              <div class="token-bal">
                <span class="bal-amt">500.00</span>
                <span class="bal-usd">$50.00</span>
              </div>
            </div>

            <div class="token-item">
              <div class="token-info">
                <div class="token-logo" style="background:#6366f1; color:white; font-weight:700; font-size:11px;">
                  SWAP
                </div>
                <div class="token-meta">
                  <span class="token-symbol">SWAP</span>
                  <span class="token-name">ThruSwap Governance</span>
                </div>
              </div>
              <div class="token-bal">
                <span class="bal-amt">1,200.00</span>
                <span class="bal-usd">$120.00</span>
              </div>
            </div>
          </div>

          <button class="add-btn">
            <span>+ Add Custom Token</span>
          </button>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  renderHtmlToImage(html, path.resolve(STORE_DIR, 'screenshot-2-tokens.png'), 1280, 800);
}

// 3. Screenshot 3: Send Flow
function generateScreenshot3() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      ${SHARED_CSS}
      .send-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
      }
      .send-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .field-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .field-label {
        font-size: 12px;
        font-weight: 600;
        color: #94a3b8;
      }
      .asset-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
      }
      .input-box {
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        color: #f1f5f9;
        font-size: 13px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .review-btn {
        margin-top: auto;
        padding: 14px;
        border-radius: 12px;
        background: #0284c7;
        color: white;
        font-weight: 700;
        font-size: 14px;
        text-align: center;
        border: none;
      }
      .fee-box {
        background: rgba(14, 165, 233, 0.08);
        border: 1px solid rgba(14, 165, 233, 0.2);
        border-radius: 10px;
        padding: 10px 14px;
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: #38bdf8;
      }
    </style>
  </head>
  <body>
    <div class="bg-glow-1"></div>
    <div class="bg-glow-2"></div>
    <div class="container">
      <div class="left-pane">
        <div class="brand-badge">
          <span>Safe Transfers</span>
        </div>
        <h1 class="headline">Frictionless Transfers with <span class="highlight">Safety Checks</span></h1>
        <p class="subhead">Send native THRU and custom tokens with recipient account verification, live gas estimation, and transparent pre-sign safety confirmations.</p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">🛡️</div>
            <span>On-chain recipient existence verification</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">⛽</div>
            <span>Deterministic state-unit fee calculation</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔄</div>
            <span>Dedicated refresh button to sync latest balances</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔒</div>
            <span>Session-only signing with optional password-lock</span>
          </div>
        </div>
      </div>

      <div class="wallet-frame">
        <div class="popup-top-bar">
          <div class="dots">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
          </div>
          <span>Send THRU</span>
          <div class="network-pill">Betanet</div>
        </div>

        <div class="send-body">
          <div class="send-header">
            <span style="font-weight:700; font-size:16px;">Send</span>
            <div class="refresh-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/>
              </svg>
            </div>
          </div>

          <div class="field-group">
            <span class="field-label">Asset</span>
            <div class="asset-card">
              <div class="token-info">
                <div class="token-logo">
                  <img src="${thruCoinBase64}" alt="THRU" />
                </div>
                <div class="token-meta">
                  <span class="token-symbol">THRU</span>
                  <span class="token-name">Thru Native Token</span>
                </div>
              </div>
              <span style="font-size:12px; color:#94a3b8;">12,458.00 THRU</span>
            </div>
          </div>

          <div class="field-group">
            <span class="field-label">Recipient Address</span>
            <div class="input-box">
              <span style="font-family:monospace; font-size:12px;">ta1w9r8x...3kn7p</span>
              <span style="color:#10b981; font-size:11px; font-weight:600;">✓ Active</span>
            </div>
          </div>

          <div class="field-group">
            <span class="field-label">Amount</span>
            <div class="input-box">
              <span style="font-size:18px; font-weight:700;">50.00</span>
              <span style="color:#38bdf8; font-weight:600; font-size:12px;">MAX</span>
            </div>
            <span style="font-size:11px; color:#64748b;">≈ $5.00 USD</span>
          </div>

          <div class="fee-box">
            <span>Estimated Network Fee</span>
            <span style="font-weight:600;">0.000001 THRU</span>
          </div>

          <button class="review-btn">Review Transaction</button>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  renderHtmlToImage(html, path.resolve(STORE_DIR, 'screenshot-3-send.png'), 1280, 800);
}

// 4. Screenshot 4: Activity & Auto-Sync
function generateScreenshot4() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      ${SHARED_CSS}
      .hist-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .tx-card {
        padding: 14px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .tx-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .tx-badge {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      }
      .badge-send { background: rgba(239, 68, 68, 0.15); color: #f87171; }
      .badge-receive { background: rgba(16, 185, 129, 0.15); color: #34d399; }
      .badge-faucet { background: rgba(14, 165, 233, 0.15); color: #38bdf8; }
      .tx-details {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .tx-title {
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
      }
      .tx-sub {
        font-size: 11px;
        color: #64748b;
      }
      .tx-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
      }
      .tx-amt {
        font-size: 13px;
        font-weight: 700;
      }
      .amt-neg { color: #f87171; }
      .amt-pos { color: #34d399; }
      .tx-status {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <div class="bg-glow-1"></div>
    <div class="bg-glow-2"></div>
    <div class="container">
      <div class="left-pane">
        <div class="brand-badge">
          <span>Real-Time Activity</span>
        </div>
        <h1 class="headline">Live Activity Feed with <span class="highlight">Auto-Sync</span></h1>
        <p class="subhead">Track your on-chain transfers and contract interactions in real-time. Features 30s background auto-sync, block confirmation times, and native desktop notifications.</p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">🔄</div>
            <span>30-second automated activity synchronization</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔔</div>
            <span>Chrome desktop notifications for confirmed transfers</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">⏱️</div>
            <span>Verified block slot timestamps directly from headers</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">📋</div>
            <span>Transaction detail sheet with full explorer links</span>
          </div>
        </div>
      </div>

      <div class="wallet-frame">
        <div class="popup-top-bar">
          <div class="dots">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
          </div>
          <span>Activity</span>
          <div class="network-pill">Betanet</div>
        </div>

        <div class="hist-header">
          <span style="font-weight:700; font-size:16px;">Activity History</span>
          <div class="refresh-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/>
            </svg>
          </div>
        </div>

        <div style="flex:1; overflow-y:auto;">
          <div class="tx-card">
            <div class="tx-left">
              <div class="tx-badge badge-send">↗</div>
              <div class="tx-details">
                <span class="tx-title">Sent THRU</span>
                <span class="tx-sub">Block 48,291 · 2 mins ago</span>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-amt amt-neg">-50.00 THRU</span>
              <span class="tx-status">Confirmed</span>
            </div>
          </div>

          <div class="tx-card">
            <div class="tx-left">
              <div class="tx-badge badge-receive">↙</div>
              <div class="tx-details">
                <span class="tx-title">Received THRU</span>
                <span class="tx-sub">Block 47,810 · 1 hour ago</span>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-amt amt-pos">+1,000.00 THRU</span>
              <span class="tx-status">Confirmed</span>
            </div>
          </div>

          <div class="tx-card">
            <div class="tx-left">
              <div class="tx-badge badge-faucet">✦</div>
              <div class="tx-details">
                <span class="tx-title">Faucet Claim</span>
                <span class="tx-sub">Block 45,102 · Yesterday</span>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-amt amt-pos">+10,000.00 THRU</span>
              <span class="tx-status">Confirmed</span>
            </div>
          </div>

          <div class="tx-card">
            <div class="tx-left">
              <div class="tx-badge badge-send">↗</div>
              <div class="tx-details">
                <span class="tx-title">Sent LAB</span>
                <span class="tx-sub">Block 42,900 · 3 days ago</span>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-amt amt-neg">-100.00 LAB</span>
              <span class="tx-status">Confirmed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  renderHtmlToImage(html, path.resolve(STORE_DIR, 'screenshot-4-activity.png'), 1280, 800);
}

// 5. Screenshot 5: Security & Settings
function generateScreenshot5() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      ${SHARED_CSS}
      .settings-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
        overflow-y: auto;
      }
      .set-group {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        overflow: hidden;
      }
      .set-row {
        padding: 14px 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      }
      .set-row:last-child { border-bottom: none; }
      .set-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .set-title {
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
      }
      .set-sub {
        font-size: 11px;
        color: #64748b;
      }
      .toggle-on {
        width: 38px;
        height: 22px;
        background: #0284c7;
        border-radius: 12px;
        position: relative;
      }
      .toggle-knob {
        width: 18px;
        height: 18px;
        background: white;
        border-radius: 50%;
        position: absolute;
        top: 2px;
        right: 2px;
      }
      .badge-ctrl {
        background: rgba(255, 255, 255, 0.1);
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-family: monospace;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <div class="bg-glow-1"></div>
    <div class="bg-glow-2"></div>
    <div class="container">
      <div class="left-pane">
        <div class="brand-badge">
          <span>Security & Privacy</span>
        </div>
        <h1 class="headline">Self-Custody with <span class="highlight">Zero Compromise</span></h1>
        <p class="subhead">Built with a defense-in-depth architecture: PBKDF2 (600,000 iterations), AES-256-GCM encryption, session-only decryption, and zero telemetry.</p>
        <div class="feature-list">
          <div class="feature-item">
            <div class="feature-icon">🔒</div>
            <span>Auto-Lock timer & Quick Lock (Ctrl+L / Cmd+L)</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🛡️</div>
            <span>Mandatory password re-auth before key/seed export</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🚫</div>
            <span>Strict CSP 'none' with zero telemetry or tracking</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🌐</div>
            <span>Isolated network scoping (Betanet & Devnet)</span>
          </div>
        </div>
      </div>

      <div class="wallet-frame">
        <div class="popup-top-bar">
          <div class="dots">
            <div class="dot dot-red"></div>
            <div class="dot dot-yellow"></div>
            <div class="dot dot-green"></div>
          </div>
          <span>Settings</span>
          <div class="network-pill">Betanet</div>
        </div>

        <div class="settings-body">
          <span style="font-weight:700; font-size:16px;">Security & Preferences</span>

          <div class="set-group">
            <div class="set-row">
              <div class="set-info">
                <span class="set-title">Quick Lock Shortcut</span>
                <span class="set-sub">Lock wallet instantly</span>
              </div>
              <span class="badge-ctrl">Ctrl + L</span>
            </div>
            <div class="set-row">
              <div class="set-info">
                <span class="set-title">Auto-Lock Timer</span>
                <span class="set-sub">Lock after inactivity</span>
              </div>
              <span style="font-size:12px; color:#38bdf8; font-weight:600;">15 minutes ›</span>
            </div>
            <div class="set-row">
              <div class="set-info">
                <span class="set-title">Desktop Notifications</span>
                <span class="set-sub">Tx confirmation alerts</span>
              </div>
              <div class="toggle-on"><div class="toggle-knob"></div></div>
            </div>
          </div>

          <div class="set-group">
            <div class="set-row">
              <div class="set-info">
                <span class="set-title">Active Network</span>
                <span class="set-sub">rpc.alphanet.thru.org</span>
              </div>
              <span style="font-size:12px; color:#38bdf8; font-weight:600;">Betanet ›</span>
            </div>
            <div class="set-row">
              <div class="set-info">
                <span class="set-title">Backup Recovery Phrase</span>
                <span class="set-sub">Password required</span>
              </div>
              <span style="font-size:12px; color:#94a3b8;">Export ›</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  renderHtmlToImage(html, path.resolve(STORE_DIR, 'screenshot-5-security.png'), 1280, 800);
}

// 6. Small Promo Tile (440x280)
function generatePromoSmall() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 440px;
        height: 280px;
        overflow: hidden;
        background: radial-gradient(circle at 80% 20%, #1e293b 0%, #090c10 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: white;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 30px;
        position: relative;
      }
      .bg-glow {
        position: absolute;
        width: 300px;
        height: 300px;
        background: radial-gradient(circle, rgba(14, 165, 233, 0.25) 0%, rgba(14, 165, 233, 0) 70%);
        top: -80px;
        right: -80px;
        pointer-events: none;
      }
      .top-row {
        display: flex;
        align-items: center;
        gap: 14px;
        z-index: 1;
      }
      .logo-img {
        width: 52px;
        height: 52px;
        border-radius: 14px;
        box-shadow: 0 8px 20px rgba(14, 165, 233, 0.3);
      }
      .title-box {
        display: flex;
        flex-direction: column;
      }
      .app-title {
        font-size: 24px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .app-network {
        font-size: 12px;
        color: #38bdf8;
        font-weight: 600;
      }
      .tagline {
        font-size: 15px;
        color: #94a3b8;
        line-height: 1.4;
        max-width: 340px;
        z-index: 1;
      }
      .badge-row {
        display: flex;
        gap: 8px;
        z-index: 1;
      }
      .badge {
        padding: 4px 10px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        font-size: 11px;
        font-weight: 600;
        color: #cbd5e1;
      }
      .badge-primary {
        background: rgba(14, 165, 233, 0.15);
        border-color: rgba(14, 165, 233, 0.3);
        color: #38bdf8;
      }
    </style>
  </head>
  <body>
    <div class="bg-glow"></div>
    <div class="top-row">
      <img class="logo-img" src="${icon128Base64}" alt="Thru Wallet Logo" />
      <div class="title-box">
        <span class="app-title">Thru Wallet</span>
        <span class="app-network">Premier L1 Self-Custody</span>
      </div>
    </div>
    <p class="tagline">High-performance Chrome extension for Thru L1 with sub-second finality and AES-256-GCM security.</p>
    <div class="badge-row">
      <div class="badge badge-primary">⚡ Non-Custodial</div>
      <div class="badge">🛡️ PBKDF2 600K</div>
      <div class="badge">💎 Verified Tokens</div>
    </div>
  </body>
  </html>`;

  renderHtmlToImage(html, path.resolve(STORE_DIR, 'promo-small-440x280.png'), 440, 280);
}

// 7. Marquee Promo Banner (1400x560)
function generatePromoMarquee() {
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 1400px;
        height: 560px;
        overflow: hidden;
        background: linear-gradient(135deg, #090c10 0%, #0f172a 50%, #020617 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: white;
        display: flex;
        align-items: center;
        padding: 60px 80px;
        position: relative;
      }
      .marquee-glow-1 {
        position: absolute;
        width: 800px;
        height: 800px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(14, 165, 233, 0.18) 0%, rgba(14, 165, 233, 0) 70%);
        top: -200px;
        left: -100px;
        pointer-events: none;
      }
      .marquee-glow-2 {
        position: absolute;
        width: 800px;
        height: 800px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(99, 102, 241, 0) 70%);
        bottom: -300px;
        right: 100px;
        pointer-events: none;
      }
      .marquee-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 24px;
        z-index: 1;
        max-width: 680px;
      }
      .marquee-brand {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .marquee-logo {
        width: 64px;
        height: 64px;
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(14, 165, 233, 0.4);
      }
      .marquee-badge {
        padding: 6px 14px;
        border-radius: 20px;
        background: rgba(14, 165, 233, 0.15);
        border: 1px solid rgba(14, 165, 233, 0.3);
        color: #38bdf8;
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .marquee-title {
        font-size: 46px;
        font-weight: 800;
        line-height: 1.15;
        letter-spacing: -0.02em;
      }
      .marquee-title span {
        background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .marquee-sub {
        font-size: 18px;
        color: #94a3b8;
        line-height: 1.6;
      }
      .marquee-pills {
        display: flex;
        gap: 12px;
      }
      .marquee-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 14px;
        font-weight: 600;
        color: #e2e8f0;
      }
      .marquee-visual {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1;
      }
      .card-stack {
        position: relative;
        width: 380px;
        height: 440px;
      }
      .preview-card {
        position: absolute;
        width: 360px;
        background: #0f172a;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.7);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .preview-card-1 {
        top: 20px;
        left: 0;
        transform: rotate(-3deg);
        z-index: 2;
      }
      .preview-card-2 {
        top: 60px;
        left: 40px;
        transform: rotate(4deg);
        z-index: 1;
        opacity: 0.6;
      }
    </style>
  </head>
  <body>
    <div class="marquee-glow-1"></div>
    <div class="marquee-glow-2"></div>
    <div class="marquee-content">
      <div class="marquee-brand">
        <img class="marquee-logo" src="${icon128Base64}" alt="Thru Wallet Logo" />
        <div class="marquee-badge">Official Chrome Extension</div>
      </div>
      <h1 class="marquee-title">The Premier L1 Wallet for <span>Thru Network</span></h1>
      <p class="marquee-sub">Ultra-fast self-custody wallet featuring USD-first portfolio balances, sliding token drawer, 30s auto-sync, and hardware-grade PBKDF2 encryption.</p>
      <div class="marquee-pills">
        <div class="marquee-pill">⚡ Sub-Second Finality</div>
        <div class="marquee-pill">🛡️ AES-256-GCM Vault</div>
        <div class="marquee-pill">💎 Verified Tokens</div>
        <div class="marquee-pill">🔔 Desktop Alerts</div>
      </div>
    </div>

    <div class="marquee-visual">
      <div class="card-stack">
        <div class="preview-card preview-card-2">
          <div style="font-weight:700; color:#64748b;">Assets & Tokens</div>
          <div style="font-size:24px; font-weight:800; color:white;">12,458.00 THRU</div>
        </div>
        <div class="preview-card preview-card-1">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:24px; height:24px; border-radius:50%; background:#0284c7; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">A1</div>
              <span style="font-weight:700; font-size:13px;">Account 1</span>
            </div>
            <span style="padding:2px 8px; border-radius:10px; background:rgba(16,185,129,0.15); color:#34d399; font-size:11px; font-weight:700;">Betanet</span>
          </div>

          <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px;">
            <div style="font-size:30px; font-weight:800; color:white;">$1,245.80</div>
            <div style="font-size:13px; color:#38bdf8; font-weight:600; margin-top:2px;">12,458.00 THRU</div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:10px; text-align:center; font-size:12px; font-weight:600;">↗ Send</div>
            <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:10px; text-align:center; font-size:12px; font-weight:600;">↙ Receive</div>
            <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:10px; text-align:center; font-size:12px; font-weight:600;">⇄ Swap</div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  const rawPng = path.resolve(STORE_DIR, 'promo-marquee-raw.png');
  const targetJpg = path.resolve(STORE_DIR, 'promo-marquee-1400x560.jpg');
  renderHtmlToImage(html, rawPng, 1400, 560);
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${rawPng}'); $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $p = New-Object System.Drawing.Imaging.EncoderParameters(1); $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88); $img.Save('${targetJpg}', $codec, $p); $img.Dispose()`,
    ]);
    if (fs.existsSync(rawPng)) fs.unlinkSync(rawPng);
    console.log('✓ Optimized Marquee Banner (JPEG 1400x560):', targetJpg);
  } catch (e) {
    console.error('Failed to convert marquee banner to JPG:', e.message);
  }
}

// Generate store documentation
function generateStoreReadme() {
  const readmeContent = `# Chrome Web Store Assets — Thru Wallet

This directory contains all the visual assets required for publishing and featuring **Thru Wallet** on the Chrome Web Store.

## Store Assets Checklist

| Asset File | Dimensions | Purpose | Chrome Web Store Location |
| --- | --- | --- | --- |
| \`icon-128.png\` | 128 x 128 px | Official Store Icon | Store Listing -> Store icon |
| \`screenshot-1-dashboard.png\` | 1280 x 800 px (16:10) | Dashboard & Portfolio Balance | Store Listing -> Screenshots |
| \`screenshot-2-tokens.png\` | 1280 x 800 px (16:10) | Sliding Token Drawer & Custom Mint Verification | Store Listing -> Screenshots |
| \`screenshot-3-send.png\` | 1280 x 800 px (16:10) | Secure Transfers & Live Fee Quotes | Store Listing -> Screenshots |
| \`screenshot-4-activity.png\` | 1280 x 800 px (16:10) | Live Activity Feed & Auto-Sync | Store Listing -> Screenshots |
| \`screenshot-5-security.png\` | 1280 x 800 px (16:10) | Self-Custody Security & Shortcuts | Store Listing -> Screenshots |
| \`promo-small-440x280.png\` | 440 x 280 px | Small Promotional Tile | Store Listing -> Promotional images -> Small tile |
| \`promo-marquee-1400x560.jpg\` | 1400 x 560 px | Marquee Promotional Banner | Store Listing -> Promotional images -> Marquee tile |

## Regeneration

To regenerate all store assets from the latest codebase design:

\`\`\`bash
node scripts/generate-store-assets.mjs
\`\`\`
`;

  fs.writeFileSync(path.resolve(STORE_DIR, 'README.md'), readmeContent, 'utf-8');
  console.log('✓ Written store documentation:', path.resolve(STORE_DIR, 'README.md'));
}

console.log('--- Generating Chrome Web Store Assets ---');
generateScreenshot1();
generateScreenshot2();
generateScreenshot3();
generateScreenshot4();
generateScreenshot5();
generatePromoSmall();
generatePromoMarquee();
generateStoreReadme();

// Clean up temp render dir
try {
  fs.rmdirSync(TEMP_DIR);
} catch {}

console.log('✓ All Chrome Web Store assets generated successfully in store-assets/');
