[
  {
    "stationID": "车站ID",   //<string>车站编号，命名方法待定，用于唯一索引
    "stationName":"车站名",   //<string>车站名，用于为页面Label提供文本信息，可与其他站台名重复(用于多站台车站)
    "coordinate":{
        "x":x轴坐标,          //<float>车站中心的x轴坐标
        "z":z轴坐标           //<float>车站中心的z轴坐标
    }
    "height":"y轴坐标",          //<float>(非必要)车站的y轴坐标
    "labelL1":标识种类1,          //<integer>用于label根据数值判断使用label等级所用(1=xxx,2=xxx,3=xxx)
    "labelL2":标识种类2,          //<integer>同上，仅备用  
    "labelL3":标识种类3,          //<integer>同上，仅备用         
    "platforms": [                  //包含站台数据及特殊情况
      {
        "ID":线路ID,             //<string>站台标识码，用于唯一索引
        "condistance": 合并比例        //<integer>当缩放等级到大于某个等级时显示，反之则不显示
      }
    ]
  },
]