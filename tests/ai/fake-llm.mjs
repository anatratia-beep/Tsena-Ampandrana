// Faux serveur IA compatible OpenAI (comme LM Studio) pour les tests : /v1/models et /v1/chat/completions en SSE,
// avec raisonnement (reasoning_content et balises <think>) et appels d'outils.
import { createServer } from 'node:http';

export function fakeLlm({ port, key, model = 'qwen3.8-27b' }) {
  const state = { requests: [], down: false, failChat: 0, delay: 0 };
  const server = createServer(async (req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    if (key && req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: model }, { id: 'text-embedding' }] })); return; }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    let body = ''; for await (const c of req) body += c;
    const j = JSON.parse(body);
    state.requests.push(j);
    if (state.failChat > 0) { state.failChat--; res.writeHead(503); res.end('busy'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const msgs = j.messages;
    const last = msgs[msgs.length - 1];
    send({ reasoning_content: 'SECRET-RAISONNEMENT je réfléchis…' });
    const user = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (last.role === 'user' && j.tools && /ventes|vendu|stock|sql|commandes/i.test(user)) {
      const name = /sql/i.test(user) ? 'requete_sql' : /stock/i.test(user) ? 'stock_articles' : /vendu/i.test(user) ? 'meilleurs_articles' : /commandes/i.test(user) ? 'commandes' : 'ventes_resume';
      const args = name === 'requete_sql' ? JSON.stringify({ requete: /insert/i.test(user) ? "insert into ai.secrets values ('x','y')" : /secrets/i.test(user) ? 'select * from ai.secrets' : "select tbl, count(*) as n from ai.data group by tbl order by tbl" })
        : name === 'stock_articles' ? '{"filtre":"bientot_rupture"}' : name === 'ventes_resume' ? '{"periode":"cette_semaine"}' : '{"periode":"ce_mois"}';
      // arguments découpés en deux morceaux, comme en vrai streaming
      send({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: args.slice(0, 5) } }] });
      send({ tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }, 'tool_calls');
      res.end('data: [DONE]\n\n'); return;
    }
    const tool = [...msgs].reverse().find((m) => m.role === 'tool');
    const text = tool ? `Voici le résultat : ${tool.content.slice(0, 1500)}` : 'Bonjour ! Pour vendre sur place, ouvrez **Vente sur place**.';
    // raisonnement aussi dans le texte, coupé au milieu de la balise
    send({ content: '<thi' }); send({ content: 'nk>SECRET-THINK</th' }); send({ content: 'ink>' });
    for (let i = 0; i < text.length; i += 40) { if (state.delay) await new Promise((r) => setTimeout(r, state.delay)); if (res.destroyed) return; send({ content: text.slice(i, i + 40) }); }
    send({}, 'stop');
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) })));
}
