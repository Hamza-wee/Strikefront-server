// STRIKEFRONT co-op relay server
// Rooms up to 4 players by a short lobby code, relays their moves/shots/kills
// to everyone else in the same lobby, and tracks a shared kill feed.

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS_PER_LOBBY = 4;

const lobbies = new Map();

function getLobby(code) {
  if (!lobbies.has(code)) {
    lobbies.set(code, { players: new Map() });
  }
  return lobbies.get(code);
}

function broadcast(lobby, senderWs, message) {
  const payload = JSON.stringify(message);
  for (const client of lobby.players.keys()) {
    if (client !== senderWs && client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

function rosterOf(lobby) {
  return [...lobby.players.values()];
}

function broadcastRoster(lobby) {
  const roster = rosterOf(lobby);
  const payload = JSON.stringify({ type: 'roster', players: roster });
  for (const client of lobby.players.keys()) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('STRIKEFRONT relay is running.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let joinedLobby = null;
  let playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.lobby || 'default').slice(0, 24);
      const lobby = getLobby(code);

      if (lobby.players.size >= MAX_PLAYERS_PER_LOBBY) {
        ws.send(JSON.stringify({ type: 'full' }));
        ws.close();
        return;
      }

      playerId = Math.random().toString(36).slice(2, 9);
      joinedLobby = lobby;
      lobby.players.set(ws, {
        id: playerId,
        name: String(msg.name || 'Hunter').slice(0, 20),
        x: 0, z: 0, yaw: 0,
        kills: 0,
        wave: 1,
        alive: true,
      });

      ws.send(JSON.stringify({ type: 'joined', id: playerId }));
      broadcastRoster(lobby);
      return;
    }

    if (!joinedLobby || !joinedLobby.players.has(ws)) return;
    const state = joinedLobby.players.get(ws);

    switch (msg.type) {
      case 'state':
        state.x = msg.x; state.z = msg.z; state.yaw = msg.yaw;
        state.kills = msg.kills ?? state.kills;
        state.wave = msg.wave ?? state.wave;
        state.alive = msg.alive ?? state.alive;
        broadcast(joinedLobby, ws, { type: 'peerState', id: playerId, ...state });
        break;

      case 'shot':
        broadcast(joinedLobby, ws, { type: 'peerShot', id: playerId, x: msg.x, z: msg.z, yaw: msg.yaw });
        break;

      case 'kill':
        state.kills = msg.kills ?? state.kills;
        broadcast(joinedLobby, ws, { type: 'peerKill', id: playerId, name: state.name, kills: state.kills, demon: msg.demon });
        broadcastRoster(joinedLobby);
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (joinedLobby && joinedLobby.players.has(ws)) {
      joinedLobby.players.delete(ws);
      broadcastRoster(joinedLobby);
      if (joinedLobby.players.size === 0) {
        for (const [code, lobby] of lobbies.entries()) {
          if (lobby === joinedLobby) lobbies.delete(code);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`STRIKEFRONT relay listening on port ${PORT}`);
});
