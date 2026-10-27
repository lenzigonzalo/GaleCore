using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using MathNet.Numerics;

namespace DataFeed.Application.Functions
{
    public static class BlackScholes
    {
        // Griegas para CALL sin requerir q como parámetro
        public static (double Delta, double Gamma, double Theta, double Vega, double Rho) CallGreeks(
            double price,       // Precio subyacente
            double vol,         // Volatilidad implícita (en decimal, ej: 0.25)
            double strike,      // Strike
            double dte,         // Días hasta expiración
            double r)           // Tasa libre de riesgo (en decimal, ej: 0.05)
        {
            double q = 0.0; // Dividend yield asumido 0

            double T = dte / 365.0;
            double d1 = (Math.Log(price / strike) + (r - q + 0.5 * Math.Pow(vol, 2)) * T) / (vol * Math.Sqrt(T));
            double d2 = d1 - vol * Math.Sqrt(T);

            double Nd1 = CND(d1);
            double Nd2 = CND(d2);
            double pdf_d1 = PDF(d1);

            double calcdelta = Math.Exp(-q * T) * Nd1;
            double calcgamma = (Math.Exp(-q * T) * pdf_d1) / (price * vol * Math.Sqrt(T));
            double calctheta = -(price * pdf_d1 * vol * Math.Exp(-q * T)) / (2 * Math.Sqrt(T))
                           - r * strike * Math.Exp(-r * T) * Nd2
                           + q * price * Math.Exp(-q * T) * Nd1;
            double calcvega = price * Math.Exp(-q * T) * pdf_d1 * Math.Sqrt(T);
            double calcrho = strike * T * Math.Exp(-r * T) * Nd2;

            double delta = double.IsNaN(calcdelta) ? 0 : calcdelta;
            double gamma = double.IsNaN(calcgamma) ? 0 : calcgamma;
            double theta = double.IsNaN(calctheta) ? 0 : calctheta;
            double vega = double.IsNaN(calcvega) ? 0 : calcvega;
            double rho = double.IsNaN(calcrho) ? 0 : calcrho;

            return (delta, gamma, theta, vega, rho);
        }

        // Griegas para PUT sin requerir q como parámetro
        public static (double Delta, double Gamma, double Theta, double Vega, double Rho) PutGreeks(
            double price,
            double vol,
            double strike,
            double dte,
            double r)
        {
            double q = 0.0; // Dividend yield asumido 0

            double T = dte / 365.0;
            double d1 = (Math.Log(price / strike) + (r - q + 0.5 * Math.Pow(vol, 2)) * T) / (vol * Math.Sqrt(T));
            double d2 = d1 - vol * Math.Sqrt(T);

            double Nd1 = CND(d1);
            double Nd2 = CND(d2);
            double pdf_d1 = PDF(d1);

            double calcdelta = Math.Exp(-q * T) * (Nd1 - 1);
            double calcgamma = (Math.Exp(-q * T) * pdf_d1) / (price * vol * Math.Sqrt(T));
            double calctheta = -(price * pdf_d1 * vol * Math.Exp(-q * T)) / (2 * Math.Sqrt(T))
                           + r * strike * Math.Exp(-r * T) * CND(-d2)
                           - q * price * Math.Exp(-q * T) * CND(-d1);
            double calcvega = price * Math.Exp(-q * T) * pdf_d1 * Math.Sqrt(T);
            double calcrho = -strike * T * Math.Exp(-r * T) * CND(-d2);

            double delta = double.IsNaN(calcdelta) ? 0 : calcdelta;
            double gamma = double.IsNaN(calcgamma) ? 0 : calcgamma;
            double theta = double.IsNaN(calctheta) ? 0 : calctheta;
            double vega = double.IsNaN(calcvega) ? 0 : calcvega;
            double rho = double.IsNaN(calcrho) ? 0 : calcrho;

            return (delta, gamma, theta, vega, rho);
        }

        // Precio de una opción europea (q = 0); al vencimiento, su valor intrínseco.
        public static double Price(bool isCall, double price, double vol, double strike, double dte, double r)
        {
            double T = dte / 365.0;
            if (T <= 0 || vol <= 0)
                return Math.Max(isCall ? price - strike : strike - price, 0);
            double d1 = (Math.Log(price / strike) + (r + 0.5 * vol * vol) * T) / (vol * Math.Sqrt(T));
            double d2 = d1 - vol * Math.Sqrt(T);
            return isCall
                ? price * CND(d1) - strike * Math.Exp(-r * T) * CND(d2)
                : strike * Math.Exp(-r * T) * CND(-d2) - price * CND(-d1);
        }

        // Función de distribución acumulada normal
        private static double CND(double x)
        {
            double L = Math.Abs(x);
            double k = 1.0 / (1.0 + 0.2316419 * L);
            double w = 1.0 - 1.0 / Math.Sqrt(2 * Math.PI) *
                       Math.Exp(-L * L / 2) *
                       (0.319381530 * k - 0.356563782 * Math.Pow(k, 2) +
                        1.781477937 * Math.Pow(k, 3) - 1.821255978 * Math.Pow(k, 4) +
                        1.330274429 * Math.Pow(k, 5));
            return (x < 0) ? 1.0 - w : w;
        }

        // PDF de la normal estándar
        private static double PDF(double x)
        {
            return Math.Exp(-0.5 * x * x) / Math.Sqrt(2 * Math.PI);
        }
    }
}
