"""AI 오답분석(S-09). 실제 OpenAI 호출 없이 가짜 클라이언트로 검사한다."""
import json
import random
from types import SimpleNamespace

from quiz.analysis import analyze, build_messages, load_config
from quiz.engine import CATEGORY_ORDER, QUESTIONS_PER_CATEGORY, Game, load_questions

BANK = load_questions()
NICKNAME = "비밀닉네임"


def game_with(correct_per_category):
    game = Game.new(NICKNAME, BANK, random.Random(3), pin_hash="PINHASH")
    for _ in CATEGORY_ORDER:
        for i in range(QUESTIONS_PER_CATEGORY):
            item = game.current_item()
            game.mark_shown(item.id, 0.0)
            if i == 0:
                game.submit(item.id, None, 6.0)  # 시간 초과 1개
            else:
                pos = item.correct_pos if i < correct_per_category else (item.correct_pos + 1) % 4
                game.submit(item.id, pos, 2.0)
        game.next_category()
    return game


class FakeClient:
    calls = []

    def __init__(self, **kwargs):
        FakeClient.init_kwargs = kwargs
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        FakeClient.calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=" 분석 결과 "))])


def settings_from(values):
    return lambda key: values.get(key)


def test_payload_has_no_personal_data():
    text = json.dumps(build_messages(game_with(7)), ensure_ascii=False)
    assert NICKNAME not in text and "PINHASH" not in text
    assert "시간 초과" in text


def test_config_requires_key_and_model():
    config, message = load_config(settings_from({"OPENAI_API_KEY": "k"}))
    assert config is None and "설정되지 않았습니다" in message
    config, _ = load_config(settings_from({"OPENAI_API_KEY": "k", "OPENAI_MODEL": "m"}))
    assert config.model == "m" and config.max_output_tokens is None and config.temperature is None
    assert config.timeout_sec == 15.0


def test_config_rejects_bad_numbers():
    config, message = load_config(settings_from({"OPENAI_API_KEY": "k", "OPENAI_MODEL": "m",
                                                 "OPENAI_MAX_OUTPUT_TOKENS": "많이"}))
    assert config is None and "형식" in message


def test_options_follow_settings_only():
    FakeClient.calls = []
    config, _ = load_config(settings_from({
        "OPENAI_API_KEY": "k", "OPENAI_MODEL": "my-model", "OPENAI_BASE_URL": "https://proxy.example",
        "OPENAI_MAX_OUTPUT_TOKENS": "300", "OPENAI_TEMPERATURE": "0.2", "OPENAI_TIMEOUT_SEC": "9",
    }))
    result = analyze(game_with(7), config, client_factory=FakeClient)
    assert result.ok and result.text == "분석 결과"
    call = FakeClient.calls[-1]
    assert call["model"] == "my-model" and call["max_completion_tokens"] == 300 and call["temperature"] == 0.2
    assert FakeClient.init_kwargs["base_url"] == "https://proxy.example" and FakeClient.init_kwargs["timeout"] == 9.0


def test_unset_options_are_not_sent():
    FakeClient.calls = []
    config, _ = load_config(settings_from({"OPENAI_API_KEY": "k", "OPENAI_MODEL": "m"}))
    analyze(game_with(7), config, client_factory=FakeClient)
    assert "temperature" not in FakeClient.calls[-1] and "max_completion_tokens" not in FakeClient.calls[-1]


def test_missing_config_and_failures_do_not_raise():
    assert analyze(game_with(7), None).message == "오답분석이 설정되지 않았습니다."

    def broken(**kwargs):
        raise RuntimeError("network down, key=sk-secret")

    config, _ = load_config(settings_from({"OPENAI_API_KEY": "k", "OPENAI_MODEL": "m"}))
    result = analyze(game_with(7), config, client_factory=broken)
    assert not result.ok and "sk-secret" not in result.message


def test_perfect_game_skips_the_call():
    game = Game.new(NICKNAME, BANK, random.Random(4))
    for _ in CATEGORY_ORDER:
        for _ in range(QUESTIONS_PER_CATEGORY):
            item = game.current_item()
            game.submit(item.id, item.correct_pos)
        game.next_category()
    FakeClient.calls = []
    result = analyze(game, None, client_factory=FakeClient)
    assert result.ok and FakeClient.calls == []
