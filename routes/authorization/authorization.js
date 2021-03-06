'use strict';

const express = require('express');
const authorization = express.Router();
const request = require('request');
const fs = require('fs');


authorization.use(express.json());

authorization.route('/')
    .get((req, res, next) => {
        let users = getUsers();
        let query = req.query;
        console.log(query);
        let body = {};
        if(query && query.id) {
            body.alexaAuthorized = !!users[query.id].authorization.alexa.refreshToken;
            body.googleAuthorized = !!users[query.id].authorization.google.refreshToken;
            res.send(body);
        } else {
            res.status(400)
                .send('Bad Request, ID not specified.');
        }
    })
    .post((req, res, next) => {
        if(!req.body || !req.body.id) {
            return res.status(400).send('Bad Request, ID not specified.');
        }

        let userId = req.body.id;
        let users = getUsers();
        let user = {
            authorization: {
                google: {
                    accessToken: '',
                    refreshToken: '',
                    projectId: '',
                    languageCode: ''
                },
                alexa: {
                    accessToken: '',
                    refreshToken: ''
                }
            }
        };
        if(users[userId]) {
            res.status(204).send('Already authorized, access token might be deprecated.');
        } else {
            users[userId] = user;
            setUsers(users);
            res.status(201).send('Successfully authorized');
        }
    });

authorization.route('/alexa')
    .get(async(req, res, next) => {
        let users = getUsers();
        let query = req.query;
        if(!query.code || !query.state) {
            return res.status(400).send('Error from LWA. Please try to login again.');
        }

        let code = query.code;
        let userId = query.state;

        try {
            let authorizationResponse = await getAlexaAccessToken(code);

            let accessToken = authorizationResponse.access_token;
            let refreshToken = authorizationResponse.refresh_token;

            users[userId].authorization.alexa.accessToken = accessToken;
            users[userId].authorization.alexa.refreshToken = refreshToken;
            setUsers(users);
        } catch(e) {
            console.log(e);
            return res.status(400).send('Error from LWA. Please try to login again.');
        }

        console.log('Authorization for Alexa');
        res.writeHead(301,
            {Location: 'http://localhost:8080/' + userId}
        );
        res.end();
    });

authorization.route('/google')
    .get(async(req, res, next) => {
        let users = getUsers();
        let query = req.query;

        if(!query.code || !query.state) {
            return res.status(400).send('Error from Google Identity Platform. Please try to login again.');
        }

        let code = query.code;
        let userId = query.state;

        try {
            let authorizationResponse = await getGoogleAccessToken(code);
            console.log(authorizationResponse);
            let accessToken = authorizationResponse.access_token;
            let refreshToken = authorizationResponse.refresh_token;

            users[userId].authorization.google.accessToken = accessToken;
            users[userId].authorization.google.refreshToken = refreshToken;
            setUsers(users);
        } catch(e) {
            console.log(e);
            return res.status(400).send('Error from LWA. Please try to login again.');
        }

        res.writeHead(301,
            {Location: 'http://localhost:8080/' + query.state + '?gA=true'}
        );
        res.end();
    })
    .post((req, res, next) => {
        let body = req.body;
        if(!body.userId || body.projectId || body.languageCode) {
            return res.status(400).send('Error with authorization input, please try again.');
        }

        let userId = body.userId;
        let projectId = body.projectId;
        let language = body.languageCode;
        let users = getUsers();

        if(!users[userId]) {
            return res.status(400).send('UserId is not valid.');
        }

        users[userId].authorization.google.projectId = projectId;
        users[userId].authorization.google.languageCode = language;
        setUsers(users);

        res.send('Successful saved projectId and language.');
    });

// TODO Error handling
authorization.route('/logout')
    .post((req, res, next) => {
        let userId = req.body.userId;
        let platform = req.body.platform;
        let users = getUsers();
        users[userId].authorization[platform].accessToken = '';
        users[userId].authorization[platform].refreshToken = '';
        setUsers(users);
        res.statusCode = 200;
        res.send('Succesfully logged out!');
    });

function getAlexaAccessToken(authorizationCode) {
    let url = 'https://api.amazon.com/auth/o2/token';
    let body = 'grant_type=authorization_code&' +
        'code=' + authorizationCode + '&' +
        'client_id=amzn1.application-oa2-client.4362dbb1b7934cbeb97536ead1fec9e1&' +
        'client_secret=999dcc1fd93a2ad3ac868101f71cc7977c7003d6545f15de1b29d9fd72f97693&' +
        'redirect_uri=http://localhost:8008/authorization/alexa';

    return new Promise((resolve, reject) => {
        request.post({
            url: url,
            body: body,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, (err, res, body) => {
            if(err) {
                return reject({
                    status: err.statusCode,
                    msg: err
                });
            }
            resolve(JSON.parse(body));
        })
    })
}

function getGoogleAccessToken(authorizationCode) {
    let url = 'https://www.googleapis.com/oauth2/v4/token';
    let body = 'code=' + authorizationCode + '&' +
        'client_id=148706888226-2mu00q1fc3l6rlv3ltfgbi81qitt7qcm.apps.googleusercontent.com&' +
        'client_secret=nqClqXzARnWFLVOkKOfw_ilB&' +
        'redirect_uri=http://localhost:8008/authorization/google&' +
        'grant_type=authorization_code';

    return new Promise((resolve, reject) => {
        request.post({
            url: url,
            body: body,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, (err, res, body) => {
            if(err) {
                return reject({
                    status: err.statusCode,
                    msg: err
                });
            }
            resolve(JSON.parse(body));
        })
    })
}

function refreshAlexaAccessToken(userId) {
    console.log('Retrieving new Token...');
    let users = getUsers();
    const url = 'https://api.amazon.com/auth/o2/token';

    try {
        const body = 'grant_type=refresh_token&refresh_token=' + users[userId].authorization.alexa.refreshToken + '&' +
            'client_id=amzn1.application-oa2-client.4362dbb1b7934cb' +
            'eb97536ead1fec9e1&client_secret=999dcc1fd93a2ad3ac868101f71cc7977c7003d6545f15de1b29d9fd72f97693';

        console.log(body);
        return new Promise((resolve, reject) => {
            request.post({
                url: url,
                body: body,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }, (err, res, body) => {
                if(err) {
                    return reject(err);
                }
                console.log('New Token Received.');
                let accessToken = JSON.parse(body).access_token;

                users[userId].authorization.alexa.accessToken = accessToken;
                setUsers(users);

                resolve(accessToken);
            })
        })
    } catch(e) {
        console.log('Error DJKL J');
    }
}

function refreshGoogleAccessToken(userId) {
    console.log('Retrieving new Google Token...');
    let users = getUsers();
    const url = 'https://www.googleapis.com/oauth2/v4/token';
    const body = 'grant_type=refresh_token&refresh_token=' + users[userId].authorization.google.refreshToken + '&' +
        'client_id=148706888226-2mu00q1fc3l6rlv3ltfgbi81qitt7qcm.apps.googleusercontent.com&' +
        'client_secret=nqClqXzARnWFLVOkKOfw_ilB';

    console.log(body);

    return new Promise((resolve, reject) => {
        request.post({
            url: url,
            body: body,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, (err, res, body) => {
            if(err) {
                return reject(err);
            }
            console.log('New Token Received.');
            console.log(body);
            let accessToken = JSON.parse(body).access_token;

            users[userId].authorization.google.accessToken = accessToken;
            setUsers(users);

            resolve(accessToken);
        })
    })
}

function getAccessToken(userId, platform) {
    console.log('Get Access Token');

    let users = getUsers();
    if(users[userId]) {
        return users[userId].authorization[platform].accessToken;
    }
    return '';
}

function getGoogleProjectId(userId) {
    let users = getUsers();
    if(users[userId]) {
        return users[userId].authorization.google.projectId;
    }
    return '';
}

function getGoogleProjectLanguageCode(userId) {
    let users = getUsers();
    if(users[userId]) {
        return users[userId].authorization.google.languageCode;
    }
    return '';
}

function setUsers(json) {
    fs.writeFileSync('./routes/authorization/users.txt', JSON.stringify(json, null, 2));
}

function getUsers() {
    return JSON.parse(fs.readFileSync('./routes/authorization/users.txt'))
}


module.exports.authorization = authorization;
module.exports.getAccessToken = getAccessToken;
module.exports.refreshAlexaAccessToken = refreshAlexaAccessToken;
module.exports.refreshGoogleAccessToken = refreshGoogleAccessToken;

module.exports.getGoogleProjectId = getGoogleProjectId;
module.exports.getGoogleProjectLanguageCode = getGoogleProjectLanguageCode;