"""Unit tests for output validation."""

from pydantic import BaseModel

from galecore_ai.models.validation import validate_no_invented_numbers, validate_output


class SimpleSchema(BaseModel):
    name: str
    value: float


class TestValidateOutput:
    def test_valid_data(self):
        result = validate_output({"name": "test", "value": 1.5}, SimpleSchema)
        assert result.valid
        assert result.errors == []

    def test_missing_required_field(self):
        result = validate_output({"name": "test"}, SimpleSchema)
        assert not result.valid
        assert len(result.errors) > 0

    def test_wrong_type(self):
        result = validate_output({"name": "test", "value": "not_a_number"}, SimpleSchema)
        assert not result.valid


class TestValidateNoInventedNumbers:
    def test_all_numbers_known(self):
        text = "Net GEX is 1500000 with spot at 450.5"
        known = {1500000.0, 450.5}
        result = validate_no_invented_numbers(text, known)
        assert result.valid

    def test_invented_number_detected(self):
        text = "Net GEX is 1500000 suggesting a target of 475.0"
        known = {1500000.0, 450.5}
        result = validate_no_invented_numbers(text, known)
        assert not result.valid
        assert any("475" in e for e in result.errors)

    def test_common_numbers_also_require_evidence(self):
        text = "The value went from 0 to 1 and rose 100 percent"
        known = {500.0}
        result = validate_no_invented_numbers(text, known)
        assert not result.valid

    def test_tolerance(self):
        text = "Net GEX is approximately 1500001"
        known = {1500000.0}
        result = validate_no_invented_numbers(text, known, tolerance=5.0)
        assert result.valid

    def test_empty_text(self):
        result = validate_no_invented_numbers("", {100.0, 200.0})
        assert result.valid
