#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#include "steam/steam_api.h"

int main(int argc, char** argv) {
    const std::string target = argc == 2 ? argv[1] : "";
    if (target.size() != 17 || target.find_first_not_of("0123456789") != std::string::npos) {
        std::cerr << "Usage: SteamFriendProbe <SteamID64>\n";
        return 2;
    }
    if (!SteamAPI_Init()) {
        std::cerr << "Steamworks initialization failed. Check the running client, AppID and account license.\n";
        return 3;
    }
    struct Shutdown {
        ~Shutdown() { SteamAPI_Shutdown(); }
    } shutdown;

    ISteamFriends* friends = SteamFriends();
    ISteamUser* user = SteamUser();
    if (!friends || !user || !user->BLoggedOn()) {
        std::cerr << "The Steam client is not connected.\n";
        return 4;
    }

    const CSteamID id(static_cast<uint64>(std::stoull(target)));
    if (!friends->HasFriend(id, k_EFriendFlagImmediate)) {
        std::cerr << "The account is not in the current client's friends list.\n";
        return 5;
    }

    // Request only this consenting friend's public persona name for readiness.
    const bool waiting = friends->RequestUserInformation(id, true);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    if (waiting) {
        do {
            SteamAPI_RunCallbacks();
            const std::string name = friends->GetFriendPersonaName(id);
            if (!name.empty() && name != "[unknown]") break;
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        } while (std::chrono::steady_clock::now() < deadline);
    } else {
        SteamAPI_RunCallbacks();
    }
    if (!user->BLoggedOn() || !friends->HasFriend(id, k_EFriendFlagImmediate)) {
        std::cerr << "Steam disconnected or the friendship changed.\n";
        return 4;
    }
    const std::string name = friends->GetFriendPersonaName(id);
    if (name.empty() || name == "[unknown]") {
        std::cerr << "Steam has not supplied the friend's persona yet.\n";
        return 6;
    }

    FriendGameInfo_t game{};
    const auto state = friends->GetFriendPersonaState(id);
    const bool playing = friends->GetFriendGamePlayed(id, &game);
    std::cout << "{\"personaState\":" << static_cast<int>(state) << ",\"gameId\":";
    if (playing) std::cout << '"' << game.m_gameID.ToUint64() << '"';
    else std::cout << "null";
    std::cout << ",\"appId\":";
    if (playing && game.m_gameID.IsSteamApp()) std::cout << static_cast<unsigned int>(game.m_gameID.AppID());
    else std::cout << "null";
    std::cout << "}\n";
}
