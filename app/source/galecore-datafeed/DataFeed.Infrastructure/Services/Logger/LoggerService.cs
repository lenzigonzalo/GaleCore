namespace Infrastructure.Services.Logger
{
    public class LoggerService
    {
        public static string logFilePath = string.Empty;

        public LoggerService(string apiName)
        {
            var fileName = $"{apiName}_Log.txt";
            logFilePath = Path.Combine(Path.GetTempPath(), fileName);

            if (!File.Exists(logFilePath))
            {
                using StreamWriter writer = new StreamWriter(logFilePath, true);
                writer.WriteLine("Starting logging at " + DateTime.Now.ToString());
            }

            if (File.Exists(logFilePath))
            {
                long lenght = new FileInfo(logFilePath).Length;

                //Si el archivo supera 1MB
                if (lenght >= 1048576)
                {
                    //Se borran los archivos de logs anteriores
                    DeleteOldFiles();
                    //Se renombra el archivo de log lleno
                    File.Move(logFilePath, logFilePath + ".old");
                    //Se crea un nuevo archivo de log para escribir
                    using StreamWriter writer = new StreamWriter(logFilePath, true);
                    writer.WriteLine("Starting logging at " + DateTime.Now.ToString());
                }
            }
        }

        private void DeleteOldFiles()
        {
            string DeleteThis = ".old";
            string[] Files = Directory.GetFiles(logFilePath);

            foreach (string file in Files)
            {
                if (file.ToUpper().Contains(DeleteThis.ToUpper()))
                {
                    File.Delete(file);
                }
            }
        }

        public void Log(string message)
        {
            if (File.Exists(logFilePath))
            {
                //using StreamWriter writer = new StreamWriter(logFilePath, true);
                //writer.WriteLine(DateTime.Now.ToString() + " : " + message);
            }
        }
    }
}
