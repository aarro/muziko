var SpotifyWebApi = require('spotify-web-api-node');
var TelegramBot = require('node-telegram-bot-api');
var _ = require('lodash');
var express = require('express');
var TinyURL = require('tinyurl');
var uuid = require('uuid/v1');
var http = require("http");
var app = express();

var spotifyScopes = ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'];
var spotifyTokenMap = [];
var spotifyStateMap = [];

var spotifyApi = new SpotifyWebApi({
  clientId: process.env.spotify_clientId,
  clientSecret: process.env.spotify_clientSecret,
  redirectUri: process.env.baseUrl + '/' + process.env.spotify_callback
});

app.set('port', (process.env.PORT));

app.get('/', function (req, res) {
  res.send('<p>Online!</p>');
});

app.get('/' + process.env.spotify_callback, function (req, res) {
  if (req && req.query && req.query.state) {
    var u = _.find(spotifyStateMap, { 'u': req.query.state });

    if (req.query.code && u) {
      spotifyApi.resetAccessToken();
      spotifyApi.resetRefreshToken();

      spotifyApi.authorizationCodeGrant(req.query.code)
        .then(function (data) {
          var token = data.body;
          spotifyApi.setAccessToken(token.access_token);
          spotifyApi.getMe()
            .then(function (data) {
              var m = addSpotifyUser(token, data.body, u.id);
              console.log('Successfully added user=' + data.body.id + ' to spotifyTokenMap for chat.id' + m.chat + '. This spotifyTokenMap entry now has ' + m.users.length + ' users');
              res.status(200).send('<script>window.close();</script>;');
            }, function (err) {
              console.log('Error getting user from Spotify!', err);
              res.status(404).send(err);
            });
        }, function (err) {
          console.log('Error getting access token from Spotify!', err);
          res.status(404).send(err);
        });
    } else {
      console.log('User denied Spotify access or expired link');
      res.status(404).send('User denied access');
    }
  }
});

app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'));
});

setInterval(function () {
  http.get(process.env.baseUrl);
}, 300000); // every 5 minutes hit the site to keep heroku alive

function addSpotifyUser(token, user, state) {
  var o = _.find(spotifyTokenMap, { 'chat': state });
  if (!o) {
    o = { 'chat': state, 'users': [] };
    spotifyTokenMap.push(o);
  }
  var u = _.find(o.users, { 'id': user.id });
  if (!u) {
    u = { 'id': user.id };
    o.users.push(u);
  }
  setUserTokenMapData(u, token);
  return o;
}

function checkRefreshToken(chatId, userId) {
  var c = _.find(spotifyTokenMap, { 'chat': chatId });
  if (c) {
    var u = _.find(c.users, { 'id': userId });
    if (u) {
      var n = Date.now();
      //give it 1 minute to make sure the token hasn't expired
      if (n > (u.expires + 60000)) {
        setSpotifyApiTokens(u);
        return spotifyApi.refreshAccessToken()
          .then(function (d) {
            console.log('user=' + userId + ' access token refreshed!');
            setUserTokenMapData(u, d.body);
            setSpotifyApiTokens(u);
            return new Promise(function (res) { res(u); });
          }, function (err) {
            return new Promise(function (res, rej) { rej(err); });
          });
      } else {
        return new Promise(function (res) { res(u); });
      }
    }
  }
  return new Promise(function (res, rej) { rej('user=' + userId + ' not found in chat=' + chatId); });
}

function setUserTokenMapData(user, token) {
  user.access_token = token.access_token;
  user.refresh_token = token.refresh_token;
  user.expires = Date.now() + (1000 * token.expires_in);
}

function setSpotifyApiTokens(user) {
  spotifyApi.resetAccessToken();
  spotifyApi.resetRefreshToken();
  spotifyApi.setAccessToken(user.access_token);
  spotifyApi.setRefreshToken(user.refresh_token);
}

function searchForUserPlaylist(userId, playlistName) {
  var options = { 'limit': 50, 'offset': 0 };

  function search(userId, playlistName, options) {
    return spotifyApi.getUserPlaylists(userId, options)
      .then(function (d) {
        var m = _.find(d.body.items, { 'name': playlistName });
        if (m) {
          console.log('user=' + userId + ' found existing playlist=' + m.id);
          return new Promise(function (res) { res(m); });
        } else if (d.body.next) {
          options.offset = options.offset + options.limit;
          return search(userId, playlistName, options);
        }
        else {
          console.log('Failed to find existing playlist for user. user=' + userId);
          return new Promise(function (res) { res(undefined); });
        }
      }, function (err) {
        return new Promise(function (res, rej) { rej(err); });
      });
  }

  return search(userId, playlistName, options);
}

function getPlaylistForChatAndUser(user, name) {
  if (user.playlistId) {
    console.log('chat.title=' + name + ' user=' + user.id + ' already had playlist=' + user.playlistId + 'cached.');
    return new Promise(function (res) { res(user.playlistId); });
  } else {
    return searchForUserPlaylist(user.id, name)
      .then(function (p) {
        if (p) {
          user.playlistId = p.id;
          console.log('Routing found playlist id out of getPlaylistForChatAndUser. user=' + user.id + ' | playlist=' + user.playlistId);
          return new Promise(function (res) { res(user.playlistId); });
        } else {
          console.log('Creating a playlist for user=' + user.id);
          return spotifyApi.createPlaylist(user.id, name, { 'public': false })
            .then(function (d) {
              user.playlistId = d.body.id;
              console.log('chat.title=' + name + ' user=' + user.id + ' created playlist=' + user.playlistId);
              return new Promise(function (res) { res(user.playlistId); });
            }, function (err) {
              console.log('chat.title=' + name + ' Failed to create playlist for user=' + user.id, err);
              return new Promise(function (res, rej) { rej(err); });
            });
        }
      }, function (err) {
        return new Promise(function (res, rej) { rej(err); });
      });
  }
}

var telegramToken = process.env.telegram_token;
var bot = new TelegramBot(telegramToken, { polling: true });

//**msg.from.id is always the user, even in a group
//**msg.chat.id is the user in a direct chat but the group id in a group chat

//get the current user, make sure they're auth'd, and if so get their currently play track and share a link. 
// bot.onText(/\/share/, function (msg, match) {

// });

//tracks yo! Need to make this ignore tracks posted by the bot
bot.onText(/https:\/\/open.spotify.com\/track\/(.+)/, function (msg, match) {
  // see if there's a way to tell if a message is delayed (like sent while the bot is down) and ignore it
  var tid = match[1];
  var id = msg.chat.id;
  var name = msg.chat.title;
  var token = _.find(spotifyTokenMap, { 'chat': id });
  console.log('Found regex match for spotify track. track=' + tid + ' | chat.id=' + id + ' | chat.title=' + name);

  if (token) {
    console.log('chat.title=' + name + ' had ' + token.users.length + ' users registered for the track=' + tid);
    _.forEach(token.users, function (v) {
      checkRefreshToken(id, v.id)
        .then(function (u) {
          getPlaylistForChatAndUser(u, name)
            .then(function (pid) {
              spotifyApi.addTracksToPlaylist(u.id, pid, ["spotify:track:" + tid], { 'position': 0 })
                .then(function () {
                  console.log('chat.title=' + name + ' user=' + u.id + ' successfully added track=' + tid + ' to playlist=' + v.playlistId);
                }, function (err) {
                  console.log('chat.title=' + name + ' user=' + u.id + ' FAILED to add track=' + tid + ' to playlist=' + v.playlistId, err);
                });
            }, function (err) {
              console.log('chat.title=' + name + ' user=' + u.id + ' playlist was unknown!', err);
            });
        }, function (err) {
          console.log('chat.title=' + name + ' user=' + v.id + ' failed to refresh token!', err);
        });
    });
  }
  else {
    console.log('chat.title=' + name + ' had no users registered for the track=' + tid);
    bot.sendMessage(id, 'I\'m sorry but no one in this chat seems to be registered');
  }
});

//authenticate the group with spotify.
bot.onText(/\/auth/, function (msg) {
  console.log('chat.title=' + msg.chat.title + ' requesting auth!');
  var u = uuid();
  var a = spotifyApi.createAuthorizeURL(spotifyScopes, u);// + '&show_dialog=true';
  spotifyStateMap.push({ 'u': u, 'id': msg.chat.id });
  TinyURL.shorten(a, function (res) {
    bot.sendMessage(msg.chat.id, "Please visit the following link to associate your spotify account. " + res);
  });
});