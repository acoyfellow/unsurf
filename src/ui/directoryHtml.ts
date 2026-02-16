// Auto-generated - do not edit directly
// Edit src/ui/directory.html and run: bun run build:ui

export const directoryHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>unsurf — The Typed Internet</title>
  <meta name="description" content="A community directory of every API on the web. Scout once, share forever.">
  <style>
    :root {
      --bg: #0a0a0a;
      --fg: #fafafa;
      --muted: #888;
      --accent: #3b82f6;
      --accent-hover: #60a5fa;
      --card-bg: #141414;
      --border: #2a2a2a;
      --success: #22c55e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }
    
    /* Hero */
    .hero {
      text-align: center;
      padding: 4rem 0 3rem;
      border-bottom: 1px solid var(--border);
    }
    .hero h1 {
      font-size: 3rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--fg) 0%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero .tagline {
      font-size: 1.25rem;
      color: var(--muted);
      margin-bottom: 2rem;
    }
    .hero .stats {
      display: flex;
      justify-content: center;
      gap: 3rem;
      margin-bottom: 2rem;
    }
    .stat { text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 0.875rem; color: var(--muted); }
    
    /* Search */
    .search-section { padding: 2rem 0; }
    .search-box {
      display: flex;
      gap: 0.5rem;
      max-width: 600px;
      margin: 0 auto;
    }
    .search-box input {
      flex: 1;
      padding: 1rem 1.25rem;
      font-size: 1rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--card-bg);
      color: var(--fg);
      outline: none;
      transition: border-color 0.2s;
    }
    .search-box input:focus { border-color: var(--accent); }
    .search-box input::placeholder { color: var(--muted); }
    .search-box button {
      padding: 1rem 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      border: none;
      border-radius: 0.5rem;
      background: var(--accent);
      color: white;
      cursor: pointer;
      transition: background 0.2s;
    }
    .search-box button:hover { background: var(--accent-hover); }
    
    /* CTA */
    .cta-section {
      display: flex;
      justify-content: center;
      gap: 1rem;
      padding: 1.5rem 0 2rem;
      flex-wrap: wrap;
    }
    .cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      border-radius: 0.5rem;
      transition: all 0.2s;
    }
    .cta-btn.primary {
      background: var(--accent);
      color: white;
    }
    .cta-btn.primary:hover { background: var(--accent-hover); }
    .cta-btn.secondary {
      background: var(--card-bg);
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .cta-btn.secondary:hover { border-color: var(--accent); }
    
    /* Results */
    .results-section { padding: 2rem 0; }
    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }
    .results-header h2 { font-size: 1.25rem; font-weight: 600; }
    .results-count { color: var(--muted); font-size: 0.875rem; }
    
    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1rem;
    }
    .api-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      transition: border-color 0.2s;
      cursor: pointer;
    }
    .api-card:hover { border-color: var(--accent); }
    .api-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }
    .api-domain {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--fg);
    }
    .api-endpoints {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      background: var(--accent);
      color: white;
      border-radius: 1rem;
    }
    .api-caps {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      margin-bottom: 0.75rem;
    }
    .cap-tag {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      background: var(--border);
      color: var(--muted);
      border-radius: 0.25rem;
    }
    .api-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--muted);
    }
    
    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--muted);
    }
    .empty-state h3 { font-size: 1.25rem; margin-bottom: 0.5rem; color: var(--fg); }
    
    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 1rem;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      padding: 2rem;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }
    .modal-header h2 { font-size: 1.5rem; }
    .modal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      color: var(--muted);
      cursor: pointer;
    }
    .modal-close:hover { color: var(--fg); }
    .endpoint-list { list-style: none; }
    .endpoint-item {
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
    }
    .endpoint-item:last-child { border-bottom: none; }
    .endpoint-method {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      min-width: 50px;
      text-align: center;
    }
    .endpoint-method.GET { background: #22c55e22; color: #22c55e; }
    .endpoint-method.POST { background: #3b82f622; color: #3b82f6; }
    .endpoint-method.PUT { background: #f59e0b22; color: #f59e0b; }
    .endpoint-method.DELETE { background: #ef444422; color: #ef4444; }
    .endpoint-path { font-family: monospace; font-size: 0.875rem; }
    .endpoint-summary { font-size: 0.75rem; color: var(--muted); }
    
    /* How it works */
    .how-section {
      padding: 3rem 0;
      border-top: 1px solid var(--border);
    }
    .how-section h2 {
      text-align: center;
      font-size: 1.5rem;
      margin-bottom: 2rem;
    }
    .how-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
    }
    .how-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      text-align: center;
    }
    .how-card-icon {
      font-size: 2rem;
      margin-bottom: 1rem;
    }
    .how-card h3 { font-size: 1rem; margin-bottom: 0.5rem; }
    .how-card p { font-size: 0.875rem; color: var(--muted); }
    
    /* Footer */
    footer {
      padding: 2rem 0;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--muted);
      font-size: 0.875rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
    
    /* Loading */
    .loading {
      display: flex;
      justify-content: center;
      padding: 2rem;
    }
    .spinner {
      width: 2rem;
      height: 2rem;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <section class="hero">
      <h1>unsurf</h1>
      <p class="tagline">The typed internet — a community directory of every API</p>
      <div class="stats">
        <div class="stat">
          <div class="stat-value" id="stat-apis">—</div>
          <div class="stat-label">APIs indexed</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="stat-endpoints">—</div>
          <div class="stat-label">Endpoints</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="stat-caps">12</div>
          <div class="stat-label">Capabilities</div>
        </div>
      </div>
    </section>
    
    <section class="search-section">
      <form class="search-box" id="search-form">
        <input type="text" id="search-input" placeholder="Search APIs... (e.g., 'payment processing', 'stripe.com', 'contact form')">
        <button type="submit">Search</button>
      </form>
      <div class="cta-section">
        <a href="#contribute" class="cta-btn primary" onclick="showContribute()">
          <span>+</span> Contribute an API
        </a>
        <a href="https://unsurf.coey.dev" class="cta-btn secondary" target="_blank">
          📖 Documentation
        </a>
        <a href="https://github.com/acoyfellow/unsurf" class="cta-btn secondary" target="_blank">
          ⭐ GitHub
        </a>
      </div>
    </section>
    
    <section class="results-section">
      <div class="results-header">
        <h2>Directory</h2>
        <span class="results-count" id="results-count"></span>
      </div>
      <div id="results-container">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </section>
    
    <section class="how-section">
      <h2>How it works</h2>
      <div class="how-grid">
        <div class="how-card">
          <div class="how-card-icon">🔍</div>
          <h3>Scout</h3>
          <p>Visit any website with a headless browser. Capture every API call automatically.</p>
        </div>
        <div class="how-card">
          <div class="how-card-icon">📋</div>
          <h3>Publish</h3>
          <p>Share the discovered API to the directory. One scout benefits everyone.</p>
        </div>
        <div class="how-card">
          <div class="how-card-icon">🤖</div>
          <h3>Use</h3>
          <p>Agents search the directory before browsing. Get typed APIs instantly.</p>
        </div>
        <div class="how-card">
          <div class="how-card-icon">🌐</div>
          <h3>Federate</h3>
          <p>Run your own instance. Contribute to shared directories. Build the typed web together.</p>
        </div>
      </div>
    </section>
  </div>
  
  <footer>
    <div class="container">
      <p>Open source · <a href="https://github.com/acoyfellow/unsurf">GitHub</a> · Run your own instance · Built by <a href="https://coey.dev">@acoyfellow</a></p>
    </div>
  </footer>
  
  <!-- Detail Modal -->
  <div class="modal-overlay" id="detail-modal">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-domain">—</h2>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div id="modal-content">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </div>
  </div>
  
  <!-- Contribute Modal -->
  <div class="modal-overlay" id="contribute-modal">
    <div class="modal">
      <div class="modal-header">
        <h2>Contribute an API</h2>
        <button class="modal-close" onclick="closeContribute()">×</button>
      </div>
      <div style="color: var(--muted); line-height: 1.8;">
        <p style="margin-bottom: 1rem;"><strong style="color: var(--fg);">Option 1: Use the CLI</strong></p>
        <pre style="background: var(--bg); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1.5rem;"><code>npx unsurf scout https://example.com --publish</code></pre>
        
        <p style="margin-bottom: 1rem;"><strong style="color: var(--fg);">Option 2: Use the API</strong></p>
        <pre style="background: var(--bg); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1.5rem;"><code># First, scout a site
curl -X POST https://unsurf-api.coey.dev/tools/scout \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "task": "find API endpoints", "publish": true}'</code></pre>
        
        <p style="margin-bottom: 1rem;"><strong style="color: var(--fg);">Option 3: Run your own instance</strong></p>
        <pre style="background: var(--bg); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1.5rem;"><code>git clone https://github.com/acoyfellow/unsurf
cd unsurf && bun install
bun run deploy</code></pre>
        
        <p style="margin-top: 1.5rem;">Every contribution makes the directory better for everyone. The more APIs indexed, the more useful it becomes for agents.</p>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = '';  // Same origin
    
    async function loadDirectory() {
      try {
        const res = await fetch(\`\${API_BASE}/d/?limit=50\`);
        const data = await res.json();
        renderResults(data.fingerprints || []);
        updateStats(data.fingerprints || []);
      } catch (err) {
        document.getElementById('results-container').innerHTML = \`
          <div class="empty-state">
            <h3>No APIs indexed yet</h3>
            <p>Be the first to contribute! Scout a website and publish it to the directory.</p>
          </div>
        \`;
      }
    }
    
    function updateStats(fingerprints) {
      document.getElementById('stat-apis').textContent = fingerprints.length;
      const totalEndpoints = fingerprints.reduce((sum, fp) => sum + (fp.endpoints || 0), 0);
      document.getElementById('stat-endpoints').textContent = totalEndpoints;
    }
    
    function renderResults(fingerprints) {
      const container = document.getElementById('results-container');
      document.getElementById('results-count').textContent = \`\${fingerprints.length} APIs\`;
      
      if (fingerprints.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <h3>No results found</h3>
            <p>Try a different search term or contribute a new API.</p>
          </div>
        \`;
        return;
      }
      
      container.innerHTML = \`
        <div class="results-grid">
          \${fingerprints.map(fp => \`
            <div class="api-card" onclick="showDetail('\${fp.domain}')">
              <div class="api-card-header">
                <span class="api-domain">\${fp.domain}</span>
                <span class="api-endpoints">\${fp.endpoints} endpoints</span>
              </div>
              <div class="api-caps">
                \${(fp.capabilities || []).slice(0, 4).map(c => \`<span class="cap-tag">\${c}</span>\`).join('')}
                \${(fp.capabilities || []).length > 4 ? \`<span class="cap-tag">+\${fp.capabilities.length - 4}</span>\` : ''}
              </div>
              <div class="api-meta">
                <span>Auth: \${fp.auth || 'unknown'}</span>
                <span>v\${fp.version || 1}</span>
              </div>
            </div>
          \`).join('')}
        </div>
      \`;
    }
    
    async function search(query) {
      const container = document.getElementById('results-container');
      container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      
      try {
        // Try semantic search first
        const res = await fetch(\`\${API_BASE}/search?q=\${encodeURIComponent(query)}&limit=20\`);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
          // Convert search results to fingerprint-like objects for display
          const domains = [...new Set(data.results.map(r => r.domain))];
          const fingerprints = await Promise.all(
            domains.slice(0, 10).map(async d => {
              try {
                const fpRes = await fetch(\`\${API_BASE}/d/\${d}\`);
                return await fpRes.json();
              } catch { return null; }
            })
          );
          renderResults(fingerprints.filter(Boolean));
        } else {
          // Fallback to domain lookup
          try {
            const fpRes = await fetch(\`\${API_BASE}/d/\${query}\`);
            if (fpRes.ok) {
              const fp = await fpRes.json();
              renderResults([fp]);
            } else {
              renderResults([]);
            }
          } catch {
            renderResults([]);
          }
        }
      } catch (err) {
        renderResults([]);
      }
    }
    
    async function showDetail(domain) {
      const modal = document.getElementById('detail-modal');
      const content = document.getElementById('modal-content');
      document.getElementById('modal-domain').textContent = domain;
      modal.classList.add('active');
      content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      
      try {
        const res = await fetch(\`\${API_BASE}/d/\${domain}\`);
        const fp = await res.json();
        
        // Get all endpoints
        const capsHtml = await Promise.all((fp.capabilities || []).map(async cap => {
          try {
            const capRes = await fetch(\`\${API_BASE}/d/\${domain}/\${cap}\`);
            const slice = await capRes.json();
            return slice.endpoints || [];
          } catch { return []; }
        }));
        const allEndpoints = capsHtml.flat();
        
        content.innerHTML = \`
          <div style="margin-bottom: 1.5rem;">
            <p style="color: var(--muted); margin-bottom: 0.5rem;">URL: <a href="\${fp.url}" target="_blank" style="color: var(--accent);">\${fp.url}</a></p>
            <p style="color: var(--muted); margin-bottom: 0.5rem;">Auth: \${fp.auth || 'unknown'}</p>
            <p style="color: var(--muted);">Confidence: \${((fp.confidence || 0) * 100).toFixed(0)}%</p>
          </div>
          <h3 style="margin-bottom: 1rem;">Endpoints (\${allEndpoints.length})</h3>
          <ul class="endpoint-list">
            \${allEndpoints.map(ep => \`
              <li class="endpoint-item">
                <span class="endpoint-method \${ep.method}">\${ep.method}</span>
                <div>
                  <div class="endpoint-path">\${ep.path}</div>
                  <div class="endpoint-summary">\${ep.summary || ''}</div>
                </div>
              </li>
            \`).join('')}
          </ul>
          <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem;">
            <a href="\${API_BASE}/d/\${domain}/spec" target="_blank" class="cta-btn secondary" style="flex: 1; justify-content: center;">
              Download OpenAPI Spec
            </a>
          </div>
        \`;
      } catch (err) {
        content.innerHTML = \`<div class="empty-state"><p>Failed to load details</p></div>\`;
      }
    }
    
    function closeModal() {
      document.getElementById('detail-modal').classList.remove('active');
    }
    
    function showContribute() {
      document.getElementById('contribute-modal').classList.add('active');
    }
    
    function closeContribute() {
      document.getElementById('contribute-modal').classList.remove('active');
    }
    
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });
    
    // Search form
    document.getElementById('search-form').addEventListener('submit', e => {
      e.preventDefault();
      const query = document.getElementById('search-input').value.trim();
      if (query) {
        search(query);
      } else {
        loadDirectory();
      }
    });
    
    // Initial load
    loadDirectory();
  </script>
</body>
</html>
`;
