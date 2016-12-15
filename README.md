# muziko
A telegram bot to add song links to spotify playlists. https://telegram.me/MuzikoBot

#### Functional
- Authenticate users in the group with their spotify account using /auth command.
- The bot is listening for spotify track links. Once one is linked by a group member, any authenticated members will have the track added to a spotify playlist named after the group.
- Verbose logging
- The auth only lasts as long as the initial grant. Need to implement token refreshing.

#### Immediate Future
- Persistence needed so that when the bot recycles or is updated auth information isn't lost.
- /subbed to see who in the channel is currently set to receive tracks.

#### Long Term
- /share command to have the bot link your currently playing track.
- Ability for bot to track artists or public playlists
- More control over where linked tracks go 