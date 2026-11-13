// Temps réel avec les « Server-Sent Events » (SSE) : le navigateur garde une connexion ouverte
// et le serveur y écrit un message dès qu'il se passe quelque chose (achat, tirage, annonce…).
// Plus simple qu'un WebSocket : c'est du HTTP classique, à sens unique (serveur → navigateur).

export function createHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Set();

  /** Route Express : ouvre le flux et le garde ouvert. */
  function handler(req, res) {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n'); // en cas de coupure, le navigateur se reconnecte après 3 s
    res.write('event: hello\ndata: {}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  /** Envoie un événement à tous les navigateurs connectés. */
  function broadcast(event, data = {}) {
    const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, at: Date.now() })}\n\n`;
    for (const client of clients) client.write(payload);
  }

  // Un commentaire régulier empêche les proxys de couper une connexion silencieuse.
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': ping\n\n'); }, heartbeatMs);
  heartbeat.unref?.();

  return { handler, broadcast, size: () => clients.size };
}
