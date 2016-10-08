var config = {
  defaultUrl: 'http://ya.ru\nhttp://google.com\nhttp://facebook.com\nhttp://mail.ru',
  urls: {
    task: '/api/task/',
  },
  taskBoxRefreshPeriodicity: 500
};

var Root = React.createClass({
  render: function(){
    return (
      <div>
        <TasksBox />
      </div>
    )
  }
}),
Paginator = React.createClass({
  getInitialState: function() {
    return {
      page: 1,
      total: 13,
      near: 3
    };
  },
  render: function(){
    var first = Math.max(this.state.page - this.state.near, 0),
        last = Math.min(this.state.page + this.state.near, this.state.total),
        pageList = [];

    for(let i=first; i<=last; i++) {
      pageList.push({
        number: i,
        title: 'Page ' + i,
        isCurrent: i == this.state.page
      });
    };

    return (
      <div className="small-12 column">
        <ul className="pagination text-center" role="navigation" aria-label="Pagination">
          <li className="pagination-previous disabled">Previous</li>
          <li className="current"><span className="show-for-sr">You are on page</span> 1</li>
          <li><a href="#" aria-label="Page 2">2</a></li>
          <li><a href="#" aria-label="Page 3">3</a></li>
          <li><a href="#" aria-label="Page 4">4</a></li>
          <li className="ellipsis"></li>
          <li><a href="#" aria-label="Page 12">12</a></li>
          <li><a href="#" aria-label="Page 13">13</a></li>
          <li className="pagination-next"><a href="#" aria-label="Next page">Next</a></li>
        </ul>
      </div>
    )
  }
}),
TasksBox = React.createClass({
  getInitialState: function() {
    return {
      url: config.defaultUrl,
      tasks: []
    };
  },
  componentDidMount: function() {
    this.loadDataFromServer();
    setInterval(this.loadDataFromServer, config.taskBoxRefreshPeriodicity);
  },
  loadDataFromServer: function() {
    var _this = this;

    axios.get(config.urls.task, {})
      .then(function(response){
        // console.log(response);
        _this.setState({tasks: response.data.objects});
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  handleChangeUrl: function(e) {
    this.setState({url: e.target.value});
  },
  handleAddTask: function(e) {
    e.preventDefault();
    var _this = this;

    this.state.url.split('\n').map(url => {
      axios.post(config.urls.task, {
        url: url.trim()
      })
        .then(function(response) {
          console.log(response);
          _this.setState({url: ''});
        })
        .catch(function(error) {
          console.log(error);
        });
    })
  },
  handleRemoveTask: function(slug, e){
    e.preventDefault();
    var _this = this,
        url = config.urls.task + slug + '/';

    axios.delete(url, {})
      .then(function(response) {
        console.log(response);
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  render: function() {
    return (
      <div className="b-tasksbox">
        <div className="row">
          <h1>TasksBox</h1>
          <TasksForm
            url={this.state.url}
            handleAddTask={this.handleAddTask}
            handleChangeUrl={this.handleChangeUrl} />
        </div>
        <div className="row">
          <TasksList
            handleRemoveTask={this.handleRemoveTask}
            tasks={this.state.tasks} />
        </div>
      </div>
    );
  }
}),
TasksList = React.createClass({
  render: function() {
    return (
        <div className="b-taskslist">
          <div className="row">
          {this.props.tasks.map((task) => {
            var progressCls = ['progress', task.style].join(' '),
                progressStl = {width: task.progress + '%'};

            var taskImg = (task.img) ? (
              <div className="media-object-section">
                <div className="thumbnail">
                  <img src={task.img} />
                </div>
              </div>
            ) : '';

            return (
              <div key={task.slug} className="small-4 column">
                <div className="media-object">
                  {taskImg}
                  <div className="media-object-section main-section">
                    <a className="alert button" href="#" onClick={this.props.handleRemoveTask.bind(null, task.slug)}><i className="fi-x"></i></a>
                    <h3>{task.url}</h3>
                    <p>{task.message}</p>
                    <p>{task.title}</p>
                    <p>{task.heading}</p>
                    <div className={progressCls}>
                      <div className="progress-meter" style={progressStl}></div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          </div>

          <div className="row">
          <Paginator />
          </div>
        </div>
    )
  }
}),
TasksForm = React.createClass({
  render: function(){
    return (
      <div className="small-12 columns">
        <form onSubmit={this.props.handleAddTask}>
          <label htmlFor="id_url">URL: </label>
          <textarea
            onChange={this.props.handleChangeUrl}
            id="id_url"
            name="id_url"
            rows="5"
            placeholder="Enter url to parse"
            defaultValue={this.props.url}></textarea>
          <button type="submit" className="success button">Add tasks</button>
        </form>
    </div>
    )
  }
});

ReactDOM.render(<TasksBox />, document.getElementById('content'));
