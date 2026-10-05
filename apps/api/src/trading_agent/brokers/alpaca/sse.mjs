// Server-sent events reader (Stage 23) for GET /v2/events/trades. Firm-wide stream (all of the
// correspondent's accounts). Without since / since_id the stream carries no history, so a consumer
// resumes from the last event_id it durably processed (ULIDs sort lexically). Comment lines
// (": …") are server notices (e.g. slow-client warnings) and are surfaced, not dropped silently.
export async function* parseSse(body, { onComment = () => {} } = {}) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(buf[i] === '\r' ? i + 4 : i + 2);
      const data = [];
      let id = null;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) { onComment(line.slice(1).trim()); continue; }
        const [field, ...rest] = line.split(':');
        const value = rest.join(':').replace(/^ /, '');
        if (field === 'data') data.push(value);
        else if (field === 'id') id = value;
      }
      if (data.length) yield { id, data: data.join('\n') };
    }
  }
}
