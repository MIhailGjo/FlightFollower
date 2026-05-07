const express = require("express");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = 3000;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || "aerodatabox.p.rapidapi.com";
const AERODATABOX_URL = `https://${RAPIDAPI_HOST}`;
const flightRouter = express.Router();
const favoriteRouter = express.Router();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("Connected to MongoDB"))
        .catch((error) => console.error("MongoDB connection error:", error.message));
} else {
    console.log("MONGO_URI is not set. Favorite flights will not be saved.");
}

const favoriteFlightSchema = new mongoose.Schema({
    flightNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        unique: true
    },
    airline: {
        type: String,
        default: "Unknown"
    },
    from: {
        type: String,
        default: "Unknown"
    },
    to: {
        type: String,
        default: "Unknown"
    },
    status: {
        type: String,
        default: "Unknown"
    },
    gate: {
        type: String,
        default: "TBD"
    }
}, { timestamps: true });

const FavoriteFlight = mongoose.model("FavoriteFlight", favoriteFlightSchema);

function mongoReady() {
    return process.env.MONGO_URI && mongoose.connection.readyState === 1;
}

app.get(["/", "/mainpage", "/mainpage.html"], (req, res) => {
    res.sendFile(path.join(__dirname, "public", "mainpage.html"));
});

flightRouter.get("/:flightSearch", async (req, res) => {
    const apiKey = process.env.RAPIDAPI_KEY || process.env.AVIATIONSTACK_API_KEY;
    const flightSearch = req.params.flightSearch.trim().toUpperCase().replace(/\s+/g, "");

    if (!apiKey) {
        return res.status(500).json({ error: "Missing RAPIDAPI_KEY in .env" });
    }

    if (!flightSearch) {
        return res.status(400).json({ error: "Flight number is required." });
    }

    try {
        const response = await axios.get(`${AERODATABOX_URL}/flights/number/${flightSearch}`, {
            headers: {
                "X-RapidAPI-Key": apiKey,
                "X-RapidAPI-Host": RAPIDAPI_HOST,
                "Accept": "application/json"
            }
        });

        if (response.data.error) {
            return res.status(502).json({
                error: response.data.error.message || "AeroDataBox returned an error."
            });
        }

        const aeroDataBoxFlights = Array.isArray(response.data) ? response.data : [response.data];
        const matchingFlights = aeroDataBoxFlights.filter((flight) => flight && (flight.number || flight.flightNumber));

        if (matchingFlights.length === 0) {
            return res.status(404).json({ error: `No flight found for ${flightSearch}.` });
        }

        const flights = matchingFlights.map((flight) => ({
            flightNumber: flight.number || flight.flightNumber || flightSearch,
            airline: flight.airline?.name || "Unknown",
            from: flight.departure?.airport?.iata || flight.departure?.airport?.icao || "Unknown",
            to: flight.arrival?.airport?.iata || flight.arrival?.airport?.icao || "Unknown",
            status: flight.status || "Unknown",
            gate: flight.departure?.gate || flight.departure?.terminal || "TBD"
        }));

        res.json(flights);
    } catch (error) {
        const statusCode = error.response?.status || 500;
        const apiMessage = error.response?.data?.error?.message || error.response?.data?.message;
        const message = apiMessage || error.message || "Could not get flight data from AeroDataBox.";

        console.error("AeroDataBox request failed:", message);
        res.status(statusCode).json({ error: message });
    }
});

favoriteRouter.get("/", async (req, res) => {
    if (!mongoReady()) {
        return res.status(503).json({ error: "MongoDB is not connected. Check MONGO_URI in .env." });
    }

    try {
        const favorites = await FavoriteFlight.find().sort({ updatedAt: -1 });
        res.json(favorites);
    } catch (error) {
        res.status(500).json({ error: "Could not load favorite flights." });
    }
});

favoriteRouter.post("/", async (req, res) => {
    if (!mongoReady()) {
        return res.status(503).json({ error: "MongoDB is not connected. Check MONGO_URI in .env." });
    }

    const flight = req.body;

    if (!flight.flightNumber) {
        return res.status(400).json({ error: "Flight number is required." });
    }

    try {
        const favorite = await FavoriteFlight.findOneAndUpdate(
            { flightNumber: flight.flightNumber.trim().toUpperCase() },
            {
                flightNumber: flight.flightNumber,
                airline: flight.airline,
                from: flight.from,
                to: flight.to,
                status: flight.status,
                gate: flight.gate
            },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(201).json(favorite);
    } catch (error) {
        res.status(500).json({ error: "Could not save favorite flight." });
    }
});

favoriteRouter.delete("/:id", async (req, res) => {
    if (!mongoReady()) {
        return res.status(503).json({ error: "MongoDB is not connected. Check MONGO_URI in .env." });
    }

    try {
        const deletedFavorite = await FavoriteFlight.findByIdAndDelete(req.params.id);

        if (!deletedFavorite) {
            return res.status(404).json({ error: "Favorite flight was not found." });
        }

        res.json({ message: "Favorite flight removed." });
    } catch (error) {
        res.status(500).json({ error: "Could not remove favorite flight." });
    }
});

app.use("/api/flights", flightRouter);
app.use("/api/favorites", favoriteRouter);

const server = app.listen(PORT, () => {
    console.log(`Running at http://localhost:${PORT}`);
});

