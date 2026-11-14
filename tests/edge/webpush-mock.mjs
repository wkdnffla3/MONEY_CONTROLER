export const sent = [];
export default {
  setVapidDetails(...a) { globalThis.__vapid = a; },
  async sendNotification(sub, msg, opts) {
    if (sub.endpoint.includes('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    sent.push({ endpoint: sub.endpoint, msg: JSON.parse(msg), opts });
  },
};
