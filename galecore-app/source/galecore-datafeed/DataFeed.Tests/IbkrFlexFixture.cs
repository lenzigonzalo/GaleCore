namespace DataFeed.Tests;

/// <summary>XML sintético del Flex Web Service de IBKR (cuenta U0000000, sin datos reales).</summary>
internal static class IbkrFlexFixture
{
    public const string SendOk =
        "<FlexStatementResponse timestamp=\"23 November, 2026 10:00 AM EST\"><Status>Success</Status><ReferenceCode>1234567890</ReferenceCode>" +
        "<Url>https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement</Url></FlexStatementResponse>";

    public static string Fail(string code, string message) =>
        $"<FlexStatementResponse timestamp=\"23 November, 2026 10:00 AM EST\"><Status>Fail</Status><ErrorCode>{code}</ErrorCode><ErrorMessage>{message}</ErrorMessage></FlexStatementResponse>";

    public const string Report = """
        <FlexQueryResponse queryName="GaleCore" type="AF">
          <FlexStatements count="1">
            <FlexStatement accountId="U0000000" fromDate="20261120" toDate="20261120" period="LastBusinessDay" whenGenerated="20261121;163045">
              <AccountInformation accountId="U0000000" currency="USD" name="Cuenta de prueba" />
              <CashReport>
                <CashReportCurrency accountId="U0000000" currency="USD" endingCash="12500.55" />
                <CashReportCurrency accountId="U0000000" currency="EUR" endingCash="-300.10" />
                <CashReportCurrency accountId="U0000000" currency="BASE_SUMMARY" endingCash="12170.25" />
              </CashReport>
              <OpenPositions>
                <OpenPosition accountId="U0000000" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" listingExchange="NASDAQ" levelOfDetail="SUMMARY" position="100" multiplier="1" markPrice="180.25" positionValue="18025" costBasisPrice="150" costBasisMoney="15000" fifoPnlUnrealized="3025" fxRateToBase="1" />
                <OpenPosition accountId="U0000000" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" listingExchange="NASDAQ" levelOfDetail="LOT" position="40" multiplier="1" markPrice="180.25" positionValue="7210" costBasisPrice="140" costBasisMoney="5600" fifoPnlUnrealized="1610" fxRateToBase="1" />
                <OpenPosition accountId="U0000000" currency="USD" assetCategory="OPT" symbol="SPY   261218P00500000" description="SPY 18DEC26 500 P" listingExchange="" levelOfDetail="SUMMARY" position="-2" multiplier="100" markPrice="4.5" positionValue="-900" costBasisPrice="6" costBasisMoney="-1200" fifoPnlUnrealized="300" putCall="P" strike="500" expiry="20261218" underlyingSymbol="SPY" fxRateToBase="1" />
              </OpenPositions>
              <EquitySummaryInBase>
                <EquitySummaryByReportDateInBase accountId="U0000000" reportDate="20261119" total="30000.10" />
                <EquitySummaryByReportDateInBase accountId="U0000000" reportDate="20261120" total="30125.45" />
              </EquitySummaryInBase>
            </FlexStatement>
          </FlexStatements>
        </FlexQueryResponse>
        """;
}
