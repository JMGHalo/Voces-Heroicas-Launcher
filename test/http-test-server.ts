import Fastify from 'fastify';

const fastify = Fastify({ logger: false });
const PORT = 3001;

fastify.get('/bulk', (req, reply) => {
  const url = req.url;
  const data = (req.query as any).data ?? '';
  console.log(`[OK] URL length: ${url.length} chars`);
  console.log(`[DATA] ${data.slice(0, 200)}${data.length > 200 ? '...' : ''}`);
  return reply.code(200).send({ ok: true });
});

fastify.listen({ port: PORT, host: '127.0.0.1' }, () => {
  console.log(`HTTP test server listening on http://127.0.0.1:${PORT}`);
  console.log(`Test with: http://127.0.0.1:${PORT}/bulk?data=<your_payload>`);
});
