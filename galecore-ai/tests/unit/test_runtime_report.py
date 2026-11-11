"""WS-0098 inc. 1: the follow-up reads the GaleCore of its connection, with the shape it already analyses."""

import pytest

from galecore_ai.application import followup
from galecore_ai.application.runtime_report import build_report


class HttpError(Exception):
    def __init__(self, status):
        self.status = status


def test_report_lists_the_instances_of_the_spec_and_keeps_http_errors_as_evidence():
    answers = {
        "/App/Runtime/Specs/s": {"contentHash": "sha256:abc"},
        "/App/Runtime/Instances": [{"instanceId": "i1", "specName": "s"}, {"instanceId": "i2", "specName": "other"}],
        "/App/Runtime/Status": {"instances": []},
        "/App/Runtime/Instances/i1": {"positions": []},
        "/App/Runtime/Instances/i1/Evaluations?limit=5": [],
        "/App/Runtime/Metrics": {},
    }

    def get(path):
        if path not in answers:
            raise HttpError(404)
        return answers[path]

    report = build_report(get, "https://prod.example", "s", limit=5)

    assert report["api"] == "https://prod.example" and report["spec_content_hash"] == "sha256:abc"
    assert [i["instance"]["instanceId"] for i in report["instances"]] == ["i1"]
    assert report["instances"][0]["events"] == {"http": 404, "body": None}
    assert report["status"] == {"http": 200, "body": {"instances": []}}


def test_an_unreachable_galecore_fails_the_report_instead_of_looking_empty():
    def get(path):
        raise ConnectionError("down")

    with pytest.raises(ConnectionError):
        build_report(get, "https://prod.example", "s")


def test_the_default_command_does_not_use_the_dev_script(tmp_path):
    cmd = followup.default_report_command(tmp_path, "s")
    assert "galecore_dev.py" not in " ".join(cmd) and "galecore_ai.application.runtime_report" in cmd
