import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from accounts import AccountStore, StateConflict, clean_state, default_account_state
import server


class AccountTests(unittest.TestCase):
    def test_release_change_revokes_sessions_but_keeps_users_and_holdings(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'accounts.sqlite3'
            first=AccountStore(path,release_id='release-a')
            _,token=first.register('update_user','long-secret-A1')
            user=first.session(token)
            state={"wallet":[{"id":"btc","name":"BTC","quantity":1,"price":60000,"category":"crypto","currency":"USDT"}]}
            first.save_state(user['id'],state)
            self.assertIsNotNone(AccountStore(path,release_id='release-a').session(token))
            updated=AccountStore(path,release_id='release-b')
            self.assertIsNone(updated.session(token))
            logged,new_token=updated.login('update_user','long-secret-A1')
            self.assertEqual(logged['state']['wallet'],state['wallet'])
            self.assertIsNotNone(AccountStore(path,release_id='release-b').session(new_token))

    def test_empty_pouch_keeps_identity_after_database_reopen_and_login(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "accounts.sqlite3"
            store = AccountStore(path)
            _, token = store.register("empty_pouch", "long-secret-A1")
            user_id = store.session(token)["id"]
            group = {"id": "gp123", "name": "观察组", "petName": "观察组", "petKind": 3, "petSlot": 2}
            store.save_state(user_id, {"groups": [group], "assets": [
                {"type": "swap", "symbol": "BTC", "groupId": "gp123", "cardColor": 17}]})
            store.save_state(user_id, {"groups": [group], "assets": []})
            restored, _ = AccountStore(path).login("empty_pouch", "long-secret-A1")
            self.assertEqual(restored["state"]["assets"], [])
            retained = next(g for g in restored["state"]["groups"] if g["id"] == "gp123")
            self.assertEqual(retained, group)

    def test_card_color_survives_reload_and_rejects_invalid_indices(self):
        raw = {"groups": [{"id": "main", "name": "自选"}],
               "assets": [{"type": "swap", "symbol": "BTC", "groupId": "main", "cardColor": 99}]}
        self.assertEqual(clean_state(raw)["assets"][0]["cardColor"], 99)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "accounts.sqlite3"
            store = AccountStore(path)
            _, token = store.register("color_user", "long-secret-A1")
            store.save_state(store.session(token)["id"], raw)
            self.assertEqual(AccountStore(path).session(token)["state"]["assets"][0]["cardColor"], 99)
        for invalid in (-1, 100, True, "12", None):
            raw["assets"][0]["cardColor"] = invalid
            self.assertNotIn("cardColor", clean_state(raw)["assets"][0])

    def test_all_space_characters_and_five_positions_persist(self):
        for kind in range(8):
            with self.subTest(kind=kind):
                raw = {"groups": [{"id": "main", "name": "自选", "petKind": kind,
                                    "petSlot": 4, "petName": "星际伙伴"}],
                       "assets": [{"type": "swap", "symbol": "BTC", "groupId": "main"}]}
                state = clean_state(raw)
                self.assertEqual(state["groups"][0]["petKind"], kind)
                self.assertEqual(state["groups"][0]["petSlot"], 4)
                with tempfile.TemporaryDirectory() as folder:
                    store = AccountStore(Path(folder) / "accounts.sqlite3")
                    _, token = store.register("space_user", "long-secret-A1")
                    store.save_state(store.session(token)["id"], raw)
                    restored = AccountStore(Path(folder) / "accounts.sqlite3").session(token)["state"]
                    self.assertEqual(restored["groups"][0]["petKind"], kind)
        rejected = clean_state({"groups": [{"id": "main", "name": "自选", "petKind": 8, "petSlot": 5}], "assets": []})
        self.assertNotIn("petKind", rejected["groups"][0])
        self.assertNotIn("petSlot", rejected["groups"][0])

    def test_page_id_expires_with_its_login_session(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AccountStore(Path(folder) / "accounts.sqlite3")
            first, first_token = store.register("page_user", "long-secret-A1")
            handler = object.__new__(server.Handler)
            handler.headers = {"Host": "localhost", "Cookie": f"star_session={first_token}"}
            handler.respond = lambda status, body, mime="application/json; charset=utf-8", **kwargs: status
            with patch.object(server, "ACCOUNT_STORE", store):
                handler.path = f"/?space={first['spaceId']}"
                self.assertEqual(handler.do_GET(), 200)
                store.logout(first_token)
                self.assertEqual(handler.do_GET(), 410)
                second, second_token = store.login("page_user", "long-secret-A1")
                self.assertNotEqual(first["spaceId"], second["spaceId"])
                handler.headers["Cookie"] = f"star_session={second_token}"
                self.assertEqual(handler.do_GET(), 410)
                handler.path = f"/?space={second['spaceId']}"
                self.assertEqual(handler.do_GET(), 200)

    def test_account_state_is_private_and_persists(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "accounts.sqlite3"
            store = AccountStore(path)
            alice, alice_token = store.register("Alice_1", "long-secret-A1")
            bob, bob_token = store.register("Bob_2", "long-secret-B2")
            self.assertEqual(alice["state"],default_account_state())
            self.assertNotEqual(alice["spaceId"], bob["spaceId"])
            self.assertRegex(alice["userId"], r"^U[A-F0-9]{20}$")
            self.assertNotEqual(alice["userId"], bob["userId"])
            self.assertNotEqual(alice_token, bob_token)
            state = store.save_state(store.session(alice_token)["id"], {
                "groups": [{"id": "main", "name": "我的自选"}, {"id": "g123", "name": "科技"}],
                "assets": [{"type": "swap", "symbol": "MSFT", "groupId": "g123", "pinned": True}],
                "selected": "swap:MSFT", "tf": "1d", "scheme": "greenUp", "swing": 2,
                "toggles": {"volume": False}, "targets": {"swap:MSFT": 300},
            })
            self.assertEqual(state["assets"][0]["symbol"], "MSFT")
            self.assertEqual(AccountStore(path).session(alice_token)["state"]["selected"], "swap:MSFT")
            self.assertGreater(AccountStore(path).session(alice_token)["stateUpdated"], 0)
            second_login = AccountStore(path).login("ALICE_1", "long-secret-A1")[0]
            self.assertNotEqual(second_login["spaceId"], alice["spaceId"])
            self.assertEqual(second_login["state"]["selected"], "swap:MSFT")
            self.assertEqual(second_login["userId"], alice["userId"])
            self.assertEqual(store.session(bob_token)["state"],default_account_state())
            self.assertNotIn(b"long-secret-A1", path.read_bytes())
            store.logout(alice_token)
            self.assertIsNone(store.session(alice_token))
            self.assertEqual(store.login("ALICE_1", "long-secret-A1")[0]["state"]["tf"], "1d")

    def test_stale_tab_cannot_overwrite_new_watchlist(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AccountStore(Path(folder) / "accounts.sqlite3")
            user, token = store.register("sync_user", "long-secret-A1")
            user_id = store.session(token)["id"]
            original = user["stateUpdated"]
            state = {"groups": [{"id": "main", "name": "我的自选"}],
                     "assets": [{"type": "swap", "symbol": "BTC"}],
                     "expectedUpdated": original}
            store.save_state(user_id, state)
            with self.assertRaises(StateConflict):
                store.save_state(user_id, {**state, "assets": [], "expectedUpdated": original})
            self.assertEqual(store.session(token)["state"]["assets"][0]["symbol"], "BTC")

    def test_fifty_assets_are_preserved(self):
        state = clean_state({"groups": [], "assets": [
            {"type": "swap", "symbol": f"A{i}"} for i in range(55)]})
        self.assertEqual(len(state["assets"]), 50)

    def test_default_group_name_is_fixed(self):
        state = clean_state({"groups": [{"id": "main", "name": "其他名称"}], "assets": []})
        self.assertEqual(state["groups"], [{"id": "main", "name": "自选"}])

    def test_limits_each_group_to_fifty_and_allows_cross_group_symbol(self):
        groups = [{"id": "main", "name": "默认"}] + [
            {"id": f"g{i}", "name": f"分组{i}"} for i in range(1, 9)]
        assets = [{"type": "swap", "symbol": f"A{i}", "groupId": "main"} for i in range(55)]
        assets += [{"type": "swap", "symbol": "A0", "groupId": "g1"},
                   {"type": "swap", "symbol": "A0", "groupId": "g1"},
                   {"type": "swap", "symbol": "A1", "groupId": "g8"}]
        state = clean_state({"groups": groups, "assets": assets, "activeGroup": "g1"})
        self.assertEqual(len(state["groups"]), 9)
        self.assertEqual(sum(a["groupId"] == "main" for a in state["assets"]), 50)
        self.assertEqual(sum(a["groupId"] == "g1" for a in state["assets"]), 1)
        self.assertEqual(state["activeGroup"], "g1")
        self.assertEqual(sum(a["groupId"] == "g8" for a in state["assets"]), 1)

    def test_daily_hot_group_coexists_with_eight_custom_groups(self):
        groups = [{"id": "main", "name": "自选"}] + [
            {"id": f"g{i}", "name": f"分组{i}"} for i in range(1, 9)] + [
            {"id": "ghot", "name": "错误名称"}]
        state = clean_state({"groups": groups,
                             "assets": [{"type": "swap", "symbol": "BTC", "groupId": "ghot"}],
                             "activeGroup": "ghot"})
        self.assertEqual(len(state["groups"]), 10)
        self.assertEqual(state["groups"][-1], {"id": "ghot", "name": "热门"})
        self.assertEqual(state["assets"][0]["groupId"], "ghot")
        self.assertEqual(state["activeGroup"], "ghot")

    def test_rejects_invalid_credentials_and_discards_extra_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AccountStore(Path(folder) / "accounts.sqlite3")
            with self.assertRaises(ValueError):
                store.register("a", "short")
            store.register("valid_user", "long-secret-A1")
            with self.assertRaises(ValueError):
                store.login("valid_user", "wrong-password")
            state = clean_state({"groups": [], "assets": [
                {"type": "swap", "symbol": "BTC", "groupId": "not-real", "html": "<script>"},
                {"type": "swap", "symbol": "BTC"},
                {"type": "stock", "symbol": "AAPL"}],
                "selected": "swap:BTC", "targets": {"swap:BTC": float("inf")}, "apiKey": "never-store"})
            self.assertEqual(len(state["assets"]), 1)
            self.assertEqual(state["assets"][0]["groupId"], "main")
            self.assertNotIn("apiKey", state)
            self.assertEqual(state["targets"], {})

    def test_password_rules_change_and_unique_username(self):
        with tempfile.TemporaryDirectory() as folder:
            store = AccountStore(Path(folder) / "accounts.sqlite3")
            for password in ("abc1234", "abcdefgh", "12345678"):
                with self.assertRaises(ValueError):
                    store.register("person", password)
            user, first_token = store.register("Person", "hello1234")
            self.assertIsInstance(user["id"], int)
            with self.assertRaisesRegex(ValueError, "用户名已被使用"):
                store.register("person", "other1234")
            _, second_token = store.login("PERSON", "hello1234")
            with self.assertRaisesRegex(ValueError, "当前密码不正确"):
                store.change_password(user["id"], "wrong1234", "newpass123", second_token)
            store.change_password(user["id"], "hello1234", "newpass123", second_token)
            self.assertIsNone(store.session(first_token))
            self.assertIsNotNone(store.session(second_token))
            with self.assertRaisesRegex(ValueError, "用户名或密码不正确"):
                store.login("Person", "hello1234")
            self.assertEqual(store.login("Person", "newpass123")[0]["id"], user["id"])


if __name__ == "__main__":
    unittest.main()
