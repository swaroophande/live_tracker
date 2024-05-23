const { v4: uuidv4 } = require('uuid');

const { hashPassword, comparePassword } = require('../utils/hashPassword.js');
const { clientInstance } = require('../db/config.js');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, verifyToken2 } = require('../utils/jwt.js');

const setTokens = (res, accessToken, refreshToken) => {
    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: true, // Set to true if using HTTPS
        sameSite: 'None',
        maxAge: 60 * 60 * 1000,
    });

    res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: true, // Set to true if using HTTPS
        sameSite: 'None',
        maxAge: 24 * 60 * 60 * 1000,
    });
    // I know I could have used middleware shut up
    // 'Access-Control-Allow-Origin', to 128.0.0.0:5050
    // 'Access-Control-Allow-Credentials'
}

const signup2 = async(req, res) => {
    const { phonenumber, password, username } = req.body;

    if(!phonenumber || !password || !username)
        return res.status(401).json({ data: "unauthorized, invalid username or password" });

    const uid = uuidv4();
    const hashpassword = await hashPassword(password);
    const queryText = 'insert into "user" (uid, username, phonenumber, hashedpassword) values ($1,$2,$3,$4) returning *';
    const queryParams = [uid, username, phonenumber, hashpassword];
    let client;

    try {
        client = await clientInstance.connect();
        await clientInstance.query(queryText, queryParams);
        return res.status(201).json({ data: 'successful signup' });
    }
    catch(err) {
        if(err.code === '23505')
            return res.status(403).json({ data: 'user already exists' });
        return res.status(500).json({ data: err });
    }
    finally {
        if(client) client.release();    
    }
}

const signin = async(req, res) => {
    const { phonenumber, password } = req.body;

    if(!phonenumber || !password)
        return res.status(401).json({ data: "unauthorized, invalid username or password" });

    const queryText = 'select uid, username, hashedpassword from "user" where phonenumber = $1';
    const queryParams = [phonenumber];
    let client;

    try {
        client = await clientInstance.connect();
        const result = await clientInstance.query(queryText, queryParams);
        
        if(result.rows.length === 0)
            return res.status(401).json({ data: 'uses does not exist' });
        
        const { username, hashedpassword } = result.rows[0];
       
        if(await comparePassword(password, hashedpassword)) {
            const accessToken = generateAccessToken({ username, phonenumber });
            const refreshToken = generateRefreshToken({ username, phonenumber });
            
            await clientInstance.query('delete from refreshtokens where refreshtokens.uid in (select "user".uid from "user" where phonenumber = $1)', [phonenumber]);
            await clientInstance.query('insert into refreshtokens values($1, $2)', [result.rows[0].uid, refreshToken]);

            setTokens(res, accessToken, refreshToken);
            return res.status(200).json({ data: 'success login' });
        } else {
            return res.status(401).json({ data: 'invalid authentication credentials' });
        }

    }
    catch(err) {
        return res.status(500).json({ data: err });
    }
    finally {
        if(client) client.release();    
    }
}

const generateAndSetTokens = async (res, username, phonenumber, newTokens = true) => {
    const accessToken = generateAccessToken({
        username,
        phonenumber
    });

    let refreshToken;
    if(newTokens) {
        refreshToken = generateRefreshToken({
            username,
            phonenumber
        });

        let client;
        try {
            client = await clientInstance.connect();
            await clientInstance.query('delete from refreshtokens where refreshtokens.uid in (select "user".uid from "user" where phonenumber = $1)', [phonenumber]); 
            const result = await clientInstance.query('select * from "user" where phonenumber = $1', [phonenumber]);
            await clientInstance.query('insert into refreshtokens(uid, refreshtoken) values ($1, $2)', [result.rows[0].uid, refreshToken]);
        }
        catch(err) {
            throw new Error('new token creation error');
        }
        finally {
            if(client) client.release();
        }
    } else {
        let client;
        try {
            client = await clientInstance.connect(); 
            const result = await clientInstance.query('select refreshtoken from refreshtokens where uid in (select uid from "user" where phonenumber = $1)', [phonenumber]);
            refreshToken = result.rows[0].refreshtoken;
        }
        catch(err) {
            throw new Error('access token generation fail');
        }
        finally {
            if(client) client.release();
        }
    }

    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: false, // Set to true if using HTTPS
        sameSite: 'None',
        maxAge: 60 * 60 * 1000,
    });

    res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: false, // Set to true if using HTTPS
        sameSite: 'None',
        maxAge: 24 * 60 * 60 * 1000,
    });
    // I know I could have used middleware shut up
    res.header('Access-Control-Allow-Origin', 'http://localhost:5500');
    res.header('Access-Control-Allow-Credentials', true);
}

const refreshToken = async (req, res) => {
    if(!req.cookies.refresh_token)
        return res.status(403).json('unauthorized not session token sent');

    // let off here refresh token by saving getting the refresh token
    let client;
    try {
        const accessToken = generateAccessToken({ username, phonenumber });
        setTokens(res, accessToken, req.cookies.refresh_token);
        return res.status(201).json({ data: "successful refresh token"});        
    }
    catch(err) {
        return res.status(500).json({ data: err });
    }
}

const signup = async (req, res) => {
    const { username, phonenumber, password } = req.body;

    if(!username || !password || !phonenumber) {
        return res.status(401).json({ data: "unauthorized, invalid username or password" });
    }

    // get the hashed pass and uuid
    const hashedpassword = await hashPassword(password);
    const uuid = uuidv4();

    // query to create a user
    let client;
    const queryText = 'insert into "user" (uid, username, phonenumber, hashedpassword) values($1, $2, $3, $4) returning *';
    const queryParams = [uuid, username, phonenumber,hashedpassword];

    try {
        client = await clientInstance.connect();
        await clientInstance.query(queryText, queryParams);

        await generateAndSetTokens(res, username, phonenumber);
        return res.status(201).json({ data: 'success signup' });
    }
    catch(err) {
        // checks if the user already exists
        if(err?.code === '23505')
            return res.status(403).json({ data: 'The user already exists' });
        return res.status(500).json({ data: err });
    }
    finally {
        if(client) client.release();    
    }
}

const login = async (req, res) => {
    const { phonenumber, password } = req.body;

    if(!phonenumber || !password) {
        return res.status(401).json({ data: "unauthorized, invalid username or password" });
    }

    const queryText = 'select username, hashedpassword from "user" where phonenumber = $1';
    const queryParams = [phonenumber];
    let client;

    try {
        client = await clientInstance.connect();
        const result = await clientInstance.query(queryText, queryParams);
        
        if(result.rows.length === 0)
            return res.status(401).json({ data: 'uses does not exist' });
        
        const { username, hashedpassword } = result.rows[0];
       
        if(!(await comparePassword(password, hashedpassword)))
            return res.status(401).json({ data: 'invalid authentication credentials' });

        await generateAndSetTokens(res, username, phonenumber);
        return res.status(201).json({ data: 'success login' });
    }
    catch(err) {
        return res.status(500).json({ data: err });
    }
    finally {
        if(client) client.release();    
    }
}

const signout = async (req, res) => {

    let client;
    try {
        const { phonenumber } = verifyRefreshToken(req.cookies.refresh_token);
        await clientInstance.connect();
        await clientInstance.query('delete from refreshtokens where refreshtokens.uid in (select "user".uid from "user" where phonenumber = $1)', [phonenumber]);
        res.clearCookie('access_token');
        res.clearCookie('refresh_token');
        return res.status(204).json({ data: 'you are logged out' });
    } catch(err) {
        return res.status(500).json({ data: 'already logged out' });
    }
    finally {
        if(client) client.release();
    }
}

module.exports = {
    signup,
    signup2,
    login,
    signin,
    signout,
    refreshToken
}
