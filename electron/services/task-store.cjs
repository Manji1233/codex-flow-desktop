const fs = require('node:fs/promises');
const path = require('node:path');

function nextRun(schedule, from = new Date()) {
  const next = new Date(from);
  next.setMilliseconds(0);
  if (schedule.type === 'hourly') {
    const times = Math.max(1, Math.min(60, Number(schedule.timesPerHour || 1)));
    const interval = Math.floor(3600 / times);
    const currentSecond = next.getMinutes() * 60 + next.getSeconds();
    const nextSlot = (Math.floor(currentSecond / interval) + 1) * interval;
    next.setMinutes(0, 0, 0);
    next.setSeconds(nextSlot);
    return next.toISOString();
  }
  const [hours, minutes, seconds] = String(schedule.time || '08:00:00').split(':').map(Number);
  next.setHours(hours || 0, minutes || 0, seconds || 0, 0);
  if (schedule.type === 'weekly') {
    const targetDay = schedule.dayOfWeek === undefined || schedule.dayOfWeek === null ? 1 : Number(schedule.dayOfWeek);
    let days = (targetDay - next.getDay() + 7) % 7;
    if (days === 0 && next <= from) days = 7;
    next.setDate(next.getDate() + days);
  } else if (next <= from) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function normalizeSchedule(schedule = {}) {
  const type = ['daily', 'hourly', 'weekly'].includes(schedule.type) ? schedule.type : 'daily';
  const normalized = { type, time: String(schedule.time || '08:00:00'), timesPerHour: Math.max(1, Math.min(60, Number(schedule.timesPerHour || 1))), dayOfWeek: schedule.dayOfWeek === undefined ? 1 : Number(schedule.dayOfWeek) };
  if (type !== 'hourly' && !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(normalized.time)) throw new Error('执行时间必须是 HH:mm:ss。');
  if (type === 'weekly' && (!Number.isInteger(normalized.dayOfWeek) || normalized.dayOfWeek < 0 || normalized.dayOfWeek > 6)) throw new Error('执行星期必须在 0 到 6 之间。');
  return normalized;
}

class TaskStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'codex-flow-tasks.json');
    this.tasks = [];
    this.executions = [];
  }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      this.executions = Array.isArray(data.executions) ? data.executions : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.tasks = [];
      this.executions = [];
    }
  }
  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ tasks: this.tasks, executions: this.executions.slice(0, 1000) }, null, 2), 'utf8');
  }
  list() { return [...this.tasks].sort((a, b) => new Date(a.nextRunAt || 0) - new Date(b.nextRunAt || 0)); }
  summary() {
    const month = new Date().getMonth();
    const year = new Date().getFullYear();
    const monthly = this.executions.filter(item => { const date = new Date(item.createdAt); return date.getMonth() === month && date.getFullYear() === year; });
    return { running: this.tasks.filter(item => item.enabled).length, monthlyRuns: monthly.length, successes: monthly.filter(item => item.status === 'success').length, next: this.list().find(item => item.enabled) || null };
  }
  async save(payload) {
    if (!payload?.name?.trim() || !payload?.prompt?.trim()) throw new Error('任务名称和执行提示词不能为空。');
    const existing = payload.id ? this.tasks.find(item => item.id === payload.id) : null;
    const task = { id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || new Date().toISOString(), lastRunAt: existing?.lastRunAt || null, lastStatus: existing?.lastStatus || 'pending', ...existing, ...payload };
    task.name = payload.name.trim();
    task.prompt = payload.prompt.trim();
    task.schedule = normalizeSchedule(payload.schedule);
    task.enabled = payload.enabled !== false;
    task.nextRunAt = nextRun(task.schedule);
    if (existing) Object.assign(existing, task); else this.tasks.push(task);
    await this.persist();
    return task;
  }
  async toggle(id, enabled) { const task = this.tasks.find(item => item.id === id); if (!task) throw new Error('任务不存在。'); task.enabled = enabled; if (enabled) task.nextRunAt = nextRun(task.schedule); await this.persist(); return task; }
  async remove(id) { this.tasks = this.tasks.filter(item => item.id !== id); await this.persist(); return true; }
  due(now = new Date()) { return this.tasks.filter(item => item.enabled && item.lastStatus !== 'running' && new Date(item.nextRunAt) <= now); }
  async markRunning(id) { const task = this.tasks.find(item => item.id === id); if (!task) return; task.lastStatus = 'running'; task.lastRunAt = new Date().toISOString(); await this.persist(); }
  async complete(id, status, result) { const task = this.tasks.find(item => item.id === id); if (!task) return; task.lastStatus = status; task.lastResult = String(result || '').slice(0, 2000); task.nextRunAt = nextRun(task.schedule); this.executions.unshift({ id: crypto.randomUUID(), taskId: id, taskName: task.name, status, result: task.lastResult, createdAt: new Date().toISOString() }); await this.persist(); }
}
module.exports = { TaskStore, nextRun, normalizeSchedule };
