import {pgnRead, pgnWrite} from 'kokopu'
import cleanPgn from "./pgnCleaner.js";
import {extractPlayersFromDescription} from "./players/playersExtractor.js";
import getPlayersForId from "./players/playersOverrides.js";
import {database, NAMESPACE_VIDEO_SNIPPET} from "./db.js";
import {pgnOverrides} from "./pgnOverrides.js";
import _ from "lodash"

export type Game = {
    pgn?: string,
    fen?: string,
    playerWhite?: string,
    playerBlack?: string,
    date?: string
}

function extractDateFromDescription(id: string, linesAbove: string): string | undefined {
    const pgnNotesRegex = /\[Date\s+"(\d+[.-]\d+[.-]\d+)"]/g
    let pgnNotesMatchResult = linesAbove.match(pgnNotesRegex)
    if (pgnNotesMatchResult) {
        linesAbove = pgnNotesMatchResult[0].replaceAll('"', " ")
    }

    const yyyyMMddRegex = /\s((1[4-9]\d\d)|(20\d\d))[.-](\d|0\d|1[0-2])[.-]([0-2]\d|3[01]|\d)/g
    let year = (linesAbove.match(yyyyMMddRegex) || [])
        .map(matched => _.trim(matched))
        .map(matched => matched.replaceAll(".", "-"))
        .map(matched => {
            let split = matched.split("-");
            return `${split[0]}-${_.padStart(split[1], 2, '0')}-${_.padStart(split[2], 2, '0')}`
        })[0]

    if (!year) {
        const ddMMyyyyRegex = /\s(\d|[0-2]\d|3[01])[.-](\d|0\d|1[0-2])[.-]((1[4-9]\d\d)|(20\d\d))/g
        year = (linesAbove.match(ddMMyyyyRegex) || [])
            .map(matched => _.trim(matched))
            .map(matched => matched.replaceAll(".", "-"))
            .map(matched => {
                let split = matched.split("-");
                return `${split[2]}-${_.padStart(split[1], 2, '0')}-${_.padStart(split[0], 2, '0')}`
            })[0]
    }

    if (!year) {
        const monthddyyyyRegex = /\s(Jan|Feb|Mar|Apr|Jul|Aug|Sept|Oct|Nov|Dec)[.-](\d|0\d|1[0-2])[.-]((1[4-9]\d\d)|(20\d\d))/g
        year = (linesAbove.match(monthddyyyyRegex) || [])
            .map(matched => _.trim(matched))
            .map(matched => matched
                .replaceAll("Jan", "1")
                .replaceAll("Feb", "2")
                .replaceAll("Mar", "3")
                .replaceAll("Apr", "4")
                .replaceAll("May", "5")
                .replaceAll("Jun", "5")
                .replaceAll("Jul", "6")
                .replaceAll("Aug", "7")
                .replaceAll("Sept", "9")
                .replaceAll("Oct", "10")
                .replaceAll("Nov", "11")
                .replaceAll("Dec", "12")
            )
            .map(matched => matched.replaceAll(".", "-"))
            .map(matched => {
                let split = matched.split("-");
                return `${split[2]}-${_.padStart(split[0], 2, '0')}-${_.padStart(split[1], 2, '0')}`
            })[0]
    }

    return year
}

function extractGames(description: string, id: string): Game[] {
    description = description.replaceAll("\n. e4 c6 2.", "\n1. e4 c6 2.")

    const pgns = getPgns(id, description)

    let players = getPlayersForId(id)
    let date: string | undefined = undefined
    if (players) {
        return [{
            pgn: pgns && pgns[0] ? pgns[0].pgn : undefined,
            fen: pgns && pgns[0] ? pgns[0].fen : undefined,
            playerWhite: players.white,
            playerBlack: players.black,
            date: extractDateFromDescription(id, description)
        }]
    }

    if (pgns.length > 0) {
        const descriptionLines = description.split("\n");
        let previousPgnLineIdx = -1
        return pgns.map(pgnExtractionResult => {
            if (pgnExtractionResult.lineIdx) {
                const linesAbove = descriptionLines.slice(previousPgnLineIdx + 1, pgnExtractionResult.lineIdx + 1).join("\n") + "\n";
                players = extractPlayersFromDescription(id, linesAbove)
                date = extractDateFromDescription(id, linesAbove)
                previousPgnLineIdx = pgnExtractionResult.lineIdx
            } else {
                players = extractPlayersFromDescription(id, description)
                date = extractDateFromDescription(id, description)
            }

            let game: any = {}
            game.pgn = pgnExtractionResult.pgn
            game.fen = pgnExtractionResult.fen
            if (players) {
                game.playerWhite = players.white
                game.playerBlack = players.black
            }
            if (date) {
                game.date = date
            }
            return game
        })
    } else {
        players = extractPlayersFromDescription(id, description)
        date = extractDateFromDescription(id, description)
        let game: any = {}

        if (players) {
            game.playerWhite = players.white
            game.playerBlack = players.black
        }
        if (date) {
            game.date = date
        }

        return [game]
    }
}

enum PgnSource {
    OVERRIDE,
    LINE
}

type PgnExtraction = {
    source?: PgnSource,
    pgn?: string,
    fen?: string,
    lineIdx?: number
}

function getPgns(id: string, description: string): PgnExtraction[] {
    if (pgnOverrides[id]) {
        const kokopuParse = parseUsingKokopu(pgnOverrides[id]);
        if (!kokopuParse) {
            throw `${id} Failed to parse PGN from override`
        }
        return [
            {
                source: PgnSource.OVERRIDE,
                pgn: kokopuParse.pgn,
                fen: kokopuParse.fen
            }
        ]
    } else {
        const pgnRegex = /\n\s*(PGN: )?11?\.(?!\.)(?! Ian).+\n/mg
        let matchArray = description.match(pgnRegex)

        const resultArray: PgnExtraction[] = []
        if (matchArray != null) {
            matchArray
                .filter(pgn => pgn !== undefined)
                .filter(pgn => pgn !== null)
                .forEach(pgn => {
                    const fixedPgn = cleanPgn(pgn)
                    let parsedGame = parseUsingKokopu(fixedPgn);
                    if (parsedGame) {
                        let descriptionLines = description.split("\n");
                        let line = descriptionLines.find(line => line.indexOf(_.trim(pgn)) >= 0);
                        let initialLineIndex = undefined
                        if (line) {
                            initialLineIndex = descriptionLines.indexOf(line);
                        }

                        if (line && initialLineIndex) {
                            let lineIndex = initialLineIndex
                            let previousPgn = pgn
                            if (lineIndex >= 0) {
                                while (true) {
                                    if (lineIndex === descriptionLines.length - 1) {
                                        break
                                    }
                                    previousPgn = cleanPgn(previousPgn + " " + descriptionLines[++lineIndex])
                                    let tmpParsed = parseUsingKokopu(previousPgn)
                                    if (!tmpParsed) {
                                        break
                                    } else {
                                        parsedGame = tmpParsed
                                    }
                                }
                            }
                        }
                        resultArray.push({
                            source: PgnSource.LINE,
                            pgn: parsedGame.pgn,
                            fen: parsedGame.fen,
                            lineIdx: initialLineIndex
                        })
                    }
                })
        }
        return resultArray
    }
}

type KokopuParseResult = {
    pgn: string,
    fen: string
}

function parseUsingKokopu(pgn: string): KokopuParseResult | undefined {
    try {
        const database = pgnRead(pgn)
        const parsedPgn = pgnWrite(database.game(0))
            .replaceAll("\n", " ")
            .replaceAll(/\s{2,}/g, " ")
            .replaceAll(/\[.+]|\n/g, "")
            .replaceAll(/^\s+/g, "")

        const fen = database.game(0).finalPosition().fen()
        return {
            pgn: parsedPgn,
            fen: fen
        }
    } catch (e) {
        if (pgn.endsWith("1/2-1/2")) {
            return undefined
        }
        let tmp = parseUsingKokopu(pgn + "1/2-1/2");
        return tmp == null
            ? undefined
            : {
                pgn: tmp.pgn.replaceAll("1/2-1/2", ""),
                fen: tmp.fen
            }
    }
}

export function extractPgnForId(id: string) {
    const videoSnippet = database.read(NAMESPACE_VIDEO_SNIPPET, id)
    if (!videoSnippet) {
        return
    }

    let games = extractGames(videoSnippet.description, id);
    if (games.length > 1) {
        games = games.filter(game => game.playerWhite)
    }
    if (games.length > 0) {
        database.saveVideoGames(id, games)
    }
}

export function extractPgnForAll() {
    database.getAllIds().forEach(id => {
        extractPgnForId(id);
    })
}
