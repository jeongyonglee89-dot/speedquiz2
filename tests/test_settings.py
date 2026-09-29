"""설정 읽는 순서: st.secrets → 환경 변수 → .env (PRD 6장)."""
from quiz import settings


def use_sources(monkeypatch, secrets=None, env=None, dotenv=None):
    monkeypatch.setattr(settings, "_secrets", lambda: secrets or {})
    monkeypatch.setattr(settings, "_dotenv", lambda: dotenv or {})
    for key in ("SHEET_URL", "CONTEST_ID", "OPENAI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    for key, value in (env or {}).items():
        monkeypatch.setenv(key, value)


def test_precedence(monkeypatch):
    use_sources(monkeypatch, secrets={"OPENAI_MODEL": "from-secrets"}, env={"OPENAI_MODEL": "from-env"},
                dotenv={"OPENAI_MODEL": "from-dotenv"})
    assert settings.get("OPENAI_MODEL") == "from-secrets"
    use_sources(monkeypatch, env={"OPENAI_MODEL": "from-env"}, dotenv={"OPENAI_MODEL": "from-dotenv"})
    assert settings.get("OPENAI_MODEL") == "from-env"
    use_sources(monkeypatch, dotenv={"OPENAI_MODEL": "from-dotenv"})
    assert settings.get("OPENAI_MODEL") == "from-dotenv"


def test_empty_values_count_as_missing(monkeypatch):
    use_sources(monkeypatch, secrets={"OPENAI_MODEL": ""}, dotenv={"OPENAI_MODEL": "from-dotenv"})
    assert settings.get("OPENAI_MODEL") == "from-dotenv"
    use_sources(monkeypatch)
    assert settings.get("OPENAI_MODEL") is None and settings.get("OPENAI_MODEL", "d") == "d"


def test_missing_storage_settings_names_only(monkeypatch):
    use_sources(monkeypatch, secrets={"SHEET_URL": "https://secret-url"})
    missing = settings.missing_storage_settings()
    assert missing == ["CONTEST_ID", "[gcp_service_account]"]
    use_sources(monkeypatch, secrets={"SHEET_URL": "u", "CONTEST_ID": "c",
                                      "gcp_service_account": {"type": "service_account"}})
    assert settings.missing_storage_settings() == []
