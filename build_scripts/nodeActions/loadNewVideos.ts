import {loadNewMovies} from "../loadNewMovies.js";
import {chessComService} from "../chessCom/ChessComService.js";
import {chesstempoService} from "../chesstempo/ChesstempoService.js";
import {chess365Service} from "../chess365/Chess365Service.js";
import {extractPgnForId} from "../extractPGN.js";
import {combine} from "../combine.js";
import {lichessMastersService} from "../lichessMasters/LichessMastersService.js";

async function loadNewVideos() {
    const newIds = await loadNewMovies();

    if (newIds.length === 0) {
        return 0
    }

    for (const id of newIds) {
        extractPgnForId(id)

        try {
            await chessComService.loadInfoForId(id)
        } catch (e) {
            console.error(`Error loading chess.com info: ${e}`)
        }

        try {
            await chesstempoService.loadInfoForId(id)
        } catch (e) {
            console.error(`Error loading chesstempo.com info: ${e}`)
        }

        try {
            await chess365Service.loadInfoForId(id)
        } catch (e) {
            console.error(`Error loading 365chess.com info: ${e}`)
        }

        try {
            await lichessMastersService.loadInfoForId(id)
        } catch (e) {
            console.error(`Error loading lichess masters info: ${e}`)
        }
    }

    combine()
}

await loadNewVideos();

