let helpers
let log

const duration = 24 * 60 * 60 * 1000   // 24 hours in milliseconds

export default async (params) => {
  helpers = params.helpers
  log = params.log
  const { http } = params.events
  const handler = handlers[http.request.method]
  return handler ? handler(http) : http.response({ status: 404 })
}

const handlers = {
  post: async ({ request, response, sender }) => {
    const guess = request.params.guess
    if (!await validateGuess(guess)) return response({ status: 400 })
    let game = await getGame(sender)
    if (game.status === 'running') {
      if (!validateGame(game)) return response({ status: 400 })
      game = await play(game, guess)
    }
    return response({ body: cleanGame(game) })
  },
  get: async (http) => {
    const { response, sender } = http
    const game = await helpers.keyValue.get(getKey(sender))
    if (!game || !isToday(game.date)) return response({ status: 404 })
    return cleanGame(game)
  }
}

async function validateGuess(guess) {
  // The definition API comes back with an array of definitions if there are some and an object if not.
  // TODO right now this API appears to be having performance issues. Need to look for something different.
  // const definition = await helpers.got(`https://api.dictionaryapi.dev/api/v2/entries/en/${guess}`).json()
  const definition = []
  return guess.length === 5 && Array.isArray(definition)
}

function validateGame(game) {
  return isToday(game.date) && game.status === 'running'
}

async function play(game, guess) {
  log.info(`${game.player.login} guessed ${guess}`)
  const result = compare(game.word, guess)
  game.guesses.push(result)
  if (result.isMatch)
    game.status = 'won'
  else if (game.guesses.length === 6)
    game.status = 'lost'
  await saveGame(game)
  return game
}

function compare(word, guess) {
  const matches = []
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === word[i]) matches.push('green')
    else if (word.includes(guess[i])) matches.push('yellow')
    else matches.push('gray')
  }
  return { guess, matches, isMatch: matches.reduce((result, state) => result && state === 'green', true) }
}

async function getGame(player) {
  const game = await helpers.keyValue.get(getKey(player))
  if (game && game.word && isToday(game.date)) return game
  return { player, date: today(), status: 'running', word: await getWord(), guesses: [] }
}

async function saveGame(game) {
  return helpers.keyValue.set(getKey(game.player), game)
}

function getKey(player) {
  return `games.${player.login || '__testUser'}`
}

async function getWord() {
  const word = await helpers.keyValue.get('word')
  if (word && isToday(word.date)) return word.word
  const newWord = pickNewWord()
  await helpers.keyValue.set('word', { word: newWord, date: today() })
  return newWord
}

async function pickNewWord() {
  const words = await getWords()
  const word = words[helpers._.random(0, words.length)]
  if (!word) throw new Error(`Couldn't pick a word`)
  await helpers.keyValue.set('word', { word, date: today() })
  return word
}

async function getWords() {
  const response = await helpers.octokit.repos.getContent({ owner: 'extendohub', repo: 'gh-wordle', path: 'words.json' })
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('There was a problem loading words!')
  return JSON.parse(Buffer.from(response.data.content, 'base64').toString('utf8'))
}

function cleanGame(game) {
  return { status: game.status, guesses: game.guesses }
}

function isToday(date) {
  date = new Date(date)
  const today = new Date()
  return date.setHours(0, 0, 0, 0) === today.setHours(0, 0, 0, 0)
}

function today() {
  const today = new Date()
  return `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`
}