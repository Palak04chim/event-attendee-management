const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;
const db = new sqlite3.Database('./events.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) {
    if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes });
  }));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}

(async () => {
  await run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS attendees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE(event_id, email)
  )`);

  app.get('/api/dashboard', async (req,res) => {
    try {
      const events = await get('SELECT COUNT(*) AS count FROM events');
      const attendees = await get('SELECT COUNT(*) AS count FROM attendees');
      const upcoming = await get("SELECT COUNT(*) AS count FROM events WHERE date >= date('now')");
      const today = await get("SELECT COUNT(*) AS count FROM events WHERE date = date('now')");
      res.json({ events: events.count, attendees: attendees.count, upcoming: upcoming.count, today: today.count });
    } catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/events', async (req,res) => {
    try {
      const q = (req.query.search || '').trim();
      const rows = await all(`SELECT e.*, COUNT(a.id) attendee_count FROM events e
        LEFT JOIN attendees a ON a.event_id=e.id
        WHERE e.name LIKE ? OR e.venue LIKE ? GROUP BY e.id ORDER BY e.date ASC, e.id DESC`, [`%${q}%`,`%${q}%`]);
      res.json(rows);
    } catch(e){ res.status(500).json({error:e.message}); }
  });

  app.post('/api/events', async (req,res) => {
    const { name, date, venue, capacity } = req.body;
    if (!name || !date || !venue || !capacity || Number(capacity) < 1) return res.status(400).json({error:'Please fill all event fields correctly.'});
    try { const r = await run('INSERT INTO events(name,date,venue,capacity) VALUES(?,?,?,?)',[name.trim(),date,venue.trim(),Number(capacity)]); res.status(201).json({id:r.id}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });

  app.delete('/api/events/:id', async (req,res) => {
    try { const r = await run('DELETE FROM events WHERE id=?',[req.params.id]); if(!r.changes) return res.status(404).json({error:'Event not found.'}); res.json({message:'Event deleted.'}); }
    catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/attendees', async (req,res) => {
    try {
      const q=(req.query.search||'').trim();
      const rows=await all(`SELECT a.*, e.name event_name FROM attendees a JOIN events e ON e.id=a.event_id
        WHERE a.name LIKE ? OR a.email LIKE ? OR e.name LIKE ? ORDER BY a.registered_at DESC`, [`%${q}%`,`%${q}%`,`%${q}%`]);
      res.json(rows);
    } catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/attendees', async (req,res) => {
    const { event_id, name, email, ticket_type } = req.body;
    if(!event_id || !name || !email || !ticket_type) return res.status(400).json({error:'Please fill all attendee fields.'});
    if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
    try {
      const event=await get('SELECT * FROM events WHERE id=?',[event_id]);
      if(!event) return res.status(404).json({error:'Event not found.'});
      const count=await get('SELECT COUNT(*) AS count FROM attendees WHERE event_id=?',[event_id]);
      if(count.count >= event.capacity) return res.status(400).json({error:'This event is full.'});
      const existing=await get('SELECT id FROM attendees WHERE event_id=? AND lower(email)=lower(?)',[event_id,email.trim()]);
      if(existing) return res.status(409).json({error:'This attendee is already registered for this event.'});
      const r=await run('INSERT INTO attendees(event_id,name,email,ticket_type) VALUES(?,?,?,?)',[event_id,name.trim(),email.trim(),ticket_type]);
      res.status(201).json({id:r.id});
    } catch(e){res.status(500).json({error:e.message});}
  });

  app.delete('/api/attendees/:id', async (req,res) => {
    try { const r=await run('DELETE FROM attendees WHERE id=?',[req.params.id]); if(!r.changes) return res.status(404).json({error:'Attendee not found.'}); res.json({message:'Registration deleted.'}); }
    catch(e){res.status(500).json({error:e.message});}
  });

  app.listen(PORT, ()=>console.log(`Event Manager running at http://localhost:${PORT}`));
})();
