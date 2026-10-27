using System;
using System.Collections.Generic;

namespace DataFeed.Application.Dtos
{
    public class BaseResponse
    {
        public BaseResponse()
        {
            Start = string.Empty;
            End = string.Empty;
            Result = string.Empty;
        }

        public string Start { get; set; }
        public string End { get; set; }
        public string Result { get; set; }
    }
}