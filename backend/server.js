const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: "https://gunasimhamandalapalli1823-byte.github.io"
}));

app.use(express.json({ limit: "20kb" }));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Check whether the backend is running
app.get("/health", (req, res) => {
    res.json({
        status: "OK",
        message: "AGENT ARYA YT backend is running!"
    });
});

// Load tournaments
app.get("/api/tournaments", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, game, mode, max_teams, status
            FROM tournaments
            ORDER BY created_at DESC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Tournament query failed:", error.message);

        res.status(500).json({
            message: "Unable to load tournaments."
        });
    }
});

// Register a team
app.post("/api/tournaments/:id/registrations", async (req, res) => {
    const tournamentId = Number(req.params.id);

    if (!Number.isSafeInteger(tournamentId) || tournamentId < 1) {
        return res.status(400).json({
            message: "Invalid tournament ID."
        });
    }

    const {
        team_name,
        leader_name,
        leader_uid,
        discord_username,
        contact_number,
        player2_uid,
        player3_uid,
        player4_uid
    } = req.body || {};

    const fields = {
        team_name,
        leader_name,
        leader_uid,
        discord_username,
        contact_number,
        player2_uid,
        player3_uid,
        player4_uid
    };

    for (const [name, value] of Object.entries(fields)) {
        if (
            typeof value !== "string" ||
            value.trim().length === 0 ||
            value.trim().length > 100
        ) {
            return res.status(400).json({
                message: `Please enter a valid ${name.replace(/_/g, " ")}.`
            });
        }
    }

    const uids = [
        leader_uid,
        player2_uid,
        player3_uid,
        player4_uid
    ];

    if (!uids.every(uid => /^\d{1,30}$/.test(uid.trim()))) {
        return res.status(400).json({
            message: "Player UIDs must contain only digits."
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const tournamentResult = await client.query(
            `SELECT id, max_teams, status
             FROM tournaments
             WHERE id = $1
             FOR UPDATE`,
            [tournamentId]
        );

        if (tournamentResult.rowCount === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Tournament not found."
            });
        }

        const tournament = tournamentResult.rows[0];

        if (tournament.status !== "open") {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "Registration is closed."
            });
        }

        const countResult = await client.query(
            `SELECT COUNT(*)::int AS total
             FROM team_registrations
             WHERE tournament_id = $1
               AND status <> 'rejected'`,
            [tournamentId]
        );

        if (countResult.rows[0].total >= tournament.max_teams) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "All tournament slots are full."
            });
        }

        const result = await client.query(
            `INSERT INTO team_registrations (
                tournament_id,
                team_name,
                leader_name,
                leader_uid,
                discord_username,
                contact_number,
                player2_uid,
                player3_uid,
                player4_uid
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING id, team_name, status, created_at`,
            [
                tournamentId,
                team_name.trim(),
                leader_name.trim(),
                leader_uid.trim(),
                discord_username.trim(),
                contact_number.trim(),
                player2_uid.trim(),
                player3_uid.trim(),
                player4_uid.trim()
            ]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            message: "Team registration submitted successfully!",
            registration: result.rows[0]
        });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});

        if (error.code === "23505") {
            return res.status(409).json({
                message: "This leader has already registered."
            });
        }

        console.error("Registration failed:", error.message);

        return res.status(500).json({
            message: "Registration failed. Please try again."
        });

    } finally {
        client.release();
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`AGENT ARYA YT backend running on port ${PORT}`);
});
