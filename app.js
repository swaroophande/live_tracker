require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT | 3000;
const cookieParser = require('cookie-parser');

const authRouter = require('./router/auth.route.js');
const friendRouter = require('./router/friends.route.js');
const coordRouter = require('./router/coords.route.js');

app.use(express.static('public'))
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/healthz', (req, res) => res.status(200).send('safe'));
app.use(authRouter);
app.use(friendRouter);
app.use(coordRouter);

const server = app.listen(port, () => { console.log(`listening on port ${port}`) });

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;
