[
  {
    "platformName": "站台ID",   //<string>站台编号，命名方法待定，用于唯一索引
    "platformName":"站台名称",  //<string>站台名，用于为页面Label提供文本信息，可与其他站台名重复(用于多站台车站)
    "coordinate":{
        "x":x轴坐标,           //<float>站台的x轴坐标
        "z":z轴坐标           //<float>站台的z轴坐标
    }                           
    "height":"y轴坐标",          //<float>(非必要)站台的y轴坐标
    "labelL1":标识种类1,          //<integer>用于label根据数值判断使用label等级所用(1=xxx,2=xxx,3=xxx)
    "labelL2":标识种类2,          //<integer>同上，仅备用
    "labelL3":标识种类3,         //<integer>同上，仅备用
    "lines": [                  //经行线路数据及特殊情况判断
      {
        "ID":线路ID,                   //<string>线路标识码，用于唯一索引
        "stationCode": 1,       //<integer>(可选)车站编号；取值为1表示此为上行起点车站
        "distance": 距离,        //<float>(可选)站台距离区间起点的长度
        "NotAvaliable":可使用性, //<boolean>线路是否可用(true:可用; false:不可用)
        "Overtaking":越行,     //<boolean>线路前序方向是否在本站越行，即是否具备停靠条件(ture:越行;false:不越行)
      }
    ]

  },
]