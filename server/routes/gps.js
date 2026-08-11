const express = require('express');
const router = express.Router();

// GET /gps - Retrieve user's active Goal and Program state
router.get('/', (req, res) => {
    res.json({
        message: 'GPS state retrieval not implemented yet',
        state: {
            goal: null,
            program: null,
            schedule: null
        }
    });
});

// POST /gps - Update user's active Goal or Program state
router.post('/', (req, res) => {
    const { goal, program, schedule } = req.body;
    res.json({
        message: 'GPS state update not implemented yet',
        received: { goal, program, schedule }
    });
});

module.exports = router;
