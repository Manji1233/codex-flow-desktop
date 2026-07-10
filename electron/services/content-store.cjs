const fs = require('node:fs/promises');
const path = require('node:path');
class ContentStore {
  constructor(userDataPath) { this.filePath = path.join(userDataPath, 'codex-flow-content.json'); this.state = { sessions: [], prompts: [] }; }
  async load() { try { const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')); this.state.sessions = Array.isArray(data.sessions) ? data.sessions : []; this.state.prompts = Array.isArray(data.prompts) ? data.prompts : []; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  async persist() { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8'); }
  sessions(limit = 20) { return this.state.sessions.slice(0, limit); }
  prompts() { return this.state.prompts; }
  async addSession(session) { this.state.sessions.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...session }); this.state.sessions = this.state.sessions.slice(0, 100); await this.persist(); return this.state.sessions[0]; }
  async savePrompt(prompt) { const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), title: prompt.title || String(prompt.content).slice(0, 30), content: prompt.content }; this.state.prompts.unshift(item); await this.persist(); return item; }
  async removePrompt(id) { this.state.prompts = this.state.prompts.filter(item => item.id !== id); await this.persist(); return true; }
}
module.exports = { ContentStore };
