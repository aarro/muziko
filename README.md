# muziko
A telegram bot to add song links to spotify playlists. https://telegram.me/MuzikoBot

#### Functional
- Authenticate users in the group with their spotify account using /auth command.
- The bot is listening for spotify track links. Once one is linked by a group member, any authenticated members will have the track added to a spotify playlist named after the group.
- Verbose logging.
- Spotify token refreshing.

#### Immediate Future
- Pull a track out of any chat message (better regex...currently the message must only be the track)
- Persistence needed so that when the bot recycles or is updated auth information isn't lost.
- Proper handling of unhappy path events, such as missing playlist, failed refresh token, bad track, etc

#### Long Term
- /share command to have the bot link your currently playing track. (Wishful thinking...currently spotify api does not support this)
- Ability for bot to track artists or public playlists
- More control over where linked tracks go 