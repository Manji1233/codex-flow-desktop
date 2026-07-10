const fs = require('node:fs/promises');
const path = require('node:path');

class UsageStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'codex-flow-usage.json');
    this.records = [];
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.records = Array.isArray(data.records) ? data.records : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async add(record) {
    this.records.unshift({ id: crypto.randomUUID(), ...record });
    if (this.records.length > 10000) this.records.length = 10000;
    await fs.writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2), 'utf8');
    return this.records[0];
  }

  list(limit = 50) {
    return this.records.slice(0, limit);
  }

  summary(range = 'month') {
    const now = new Date();
    const filtered = this.records.filter(record => {
      const date = new Date(record.createdAt);
      if (range === 'day') return date.toDateString() === now.toDateString();
      if (range === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      if (range === 'year') return date.getFullYear() === now.getFullYear();
      return true;
    });
    return filtered.reduce((sum, item) => {
      sum.requests += 1;
      sum.inputTokens += Number(item.inputTokens || 0);
      sum.outputTokens += Number(item.outputTokens || 0);
      sum.totalTokens += Number(item.totalTokens || 0);
      sum.estimatedCost += Number(item.estimatedCost || 0);
      return sum;
    }, { range, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 });
  }
}

module.exports = { UsageStore };
